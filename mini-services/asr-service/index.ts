import { createServer } from 'http'
import { Server } from 'socket.io'
import ZAI from 'z-ai-web-dev-sdk'
import { randomUUID } from 'crypto'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 300000, // 5 minutes for long processing
  pingInterval: 25000,
  maxHttpBufferSize: 100e6 // 100MB
})

interface TranscriptionJob {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  fileName: string
  fileSize: number
  transcription?: string
  error?: string
  startTime?: Date
  endTime?: Date
}

const jobs = new Map<string, TranscriptionJob>()
let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null

// Progress simulation for better UX
function simulateProgress(jobId: string, socket: any) {
  const job = jobs.get(jobId)
  if (!job || job.status !== 'processing') return

  const interval = setInterval(() => {
    const currentJob = jobs.get(jobId)
    if (!currentJob || currentJob.status !== 'processing') {
      clearInterval(interval)
      return
    }

    // Increment progress gradually, max 90% (remaining 10% for final processing)
    if (currentJob.progress < 90) {
      const increment = Math.random() * 5 + 2 // 2-7% increment
      currentJob.progress = Math.min(90, currentJob.progress + increment)
      socket.emit('progress', {
        jobId,
        progress: currentJob.progress,
        status: 'processing'
      })
    }
  }, 500)

  return interval
}

async function processAudio(jobId: string, base64Audio: string, fileName: string, fileSize: number, socket: any) {
  const job = jobs.get(jobId)
  if (!job) return

  job.status = 'processing'
  job.startTime = new Date()

  const progressInterval = simulateProgress(jobId, socket)

  try {
    if (!zaiInstance) {
      zaiInstance = await ZAI.create()
    }

    const response = await zaiInstance.audio.asr.create({
      file_base64: base64Audio
    })

    clearInterval(progressInterval)

    job.progress = 100
    job.status = 'completed'
    job.transcription = response.text
    job.endTime = new Date()

    socket.emit('completed', {
      jobId,
      transcription: response.text,
      wordCount: response.text.split(/\s+/).filter(w => w.length > 0).length,
      processingTime: job.endTime.getTime() - job.startTime!.getTime()
    })

    console.log(`Job ${jobId} completed successfully`)
  } catch (error: any) {
    clearInterval(progressInterval)
    
    job.status = 'failed'
    job.error = error.message || 'Unknown error during transcription'
    job.endTime = new Date()

    socket.emit('error', {
      jobId,
      error: job.error
    })

    console.error(`Job ${jobId} failed:`, error)
  }
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`)

  socket.on('start-transcription', async (data: { 
    fileName: string
    fileSize: number
    base64Audio: string 
  }) => {
    const { fileName, fileSize, base64Audio } = data

    // Validate file size (max 100MB)
    if (fileSize > 100 * 1024 * 1024) {
      socket.emit('error', {
        error: 'File too large. Maximum size is 100MB.'
      })
      return
    }

    // Create job
    const jobId = randomUUID()
    const job: TranscriptionJob = {
      id: jobId,
      status: 'pending',
      progress: 0,
      fileName,
      fileSize
    }
    jobs.set(jobId, job)

    socket.emit('job-created', {
      jobId,
      fileName,
      fileSize
    })

    // Start processing
    processAudio(jobId, base64Audio, fileName, fileSize, socket)
  })

  socket.on('get-job-status', (data: { jobId: string }) => {
    const job = jobs.get(data.jobId)
    if (job) {
      socket.emit('job-status', {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        transcription: job.transcription,
        error: job.error
      })
    } else {
      socket.emit('error', {
        error: 'Job not found'
      })
    }
  })

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`)
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`ASR WebSocket service running on port ${PORT}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal, shutting down server...')
  httpServer.close(() => {
    console.log('ASR WebSocket server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('Received SIGINT signal, shutting down server...')
  httpServer.close(() => {
    console.log('ASR WebSocket server closed')
    process.exit(0)
  })
})
