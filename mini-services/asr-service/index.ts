import { createServer } from 'http'
import { Server } from 'socket.io'
import { randomUUID } from 'crypto'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/socket.io',
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false
  },
  pingTimeout: 600000,
  pingInterval: 25000,
  maxHttpBufferSize: 150e6
})

const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000'

interface UploadSession {
  id: string
  fileName: string
  fileSize: number
  totalChunks: number
  chunks: Map<number, Buffer>  // Store as Buffer, not base64 string!
  createdAt: Date
}

interface TranscriptionJob {
  id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  fileName: string
  fileSize: number
  transcription?: string
  language?: string
  wordCount?: number
  processingTime?: number
  error?: string
}

const uploadSessions = new Map<string, UploadSession>()
const jobs = new Map<string, TranscriptionJob>()

// Clean up old sessions every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of uploadSessions) {
    if (now - session.createdAt.getTime() > 30 * 60 * 1000) {
      uploadSessions.delete(id)
    }
  }
}, 5 * 60 * 1000)

function simulateProgress(jobId: string, socket: any) {
  const job = jobs.get(jobId)
  if (!job || job.status !== 'processing') return

  const interval = setInterval(() => {
    const currentJob = jobs.get(jobId)
    if (!currentJob || currentJob.status !== 'processing') {
      clearInterval(interval)
      return
    }

    if (currentJob.progress < 85) {
      currentJob.progress = Math.min(85, currentJob.progress + Math.random() * 2 + 0.5)
      socket.emit('progress', { jobId, progress: currentJob.progress })
    }
  }, 1000)

  return interval
}

async function transcribeWithWhisper(
  jobId: string, 
  audioBuffer: Buffer,  // Now receiving Buffer directly
  fileName: string, 
  fileSize: number, 
  socket: any
) {
  const job = jobs.get(jobId)
  if (!job) return

  job.status = 'processing'
  const progressInterval = simulateProgress(jobId, socket)

  try {
    const ext = fileName.split('.').pop()?.toLowerCase() || 'wav'
    
    const contentTypes: Record<string, string> = {
      'wav': 'audio/wav', 'mp3': 'audio/mpeg', 'm4a': 'audio/m4a',
      'flac': 'audio/flac', 'ogg': 'audio/ogg', 'webm': 'audio/webm',
      'mp4': 'audio/mp4', 'mpeg': 'audio/mpeg', 'mpga': 'audio/mpeg'
    }
    
    const contentType = contentTypes[ext] || 'audio/wav'
    console.log(`Sending ${audioBuffer.length} bytes (${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB) to Whisper service...`)

    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: contentType }), fileName)

    const response = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Whisper error: ${response.status}`)
    }

    const result = await response.json()
    
    clearInterval(progressInterval)

    job.progress = 100
    job.status = 'completed'
    job.transcription = result.text
    job.language = result.language
    job.wordCount = result.word_count
    job.processingTime = result.processing_time

    socket.emit('completed', {
      jobId,
      transcription: result.text,
      language: result.language,
      wordCount: result.word_count,
      processingTime: result.processing_time
    })

    console.log(`Job ${jobId} completed: ${result.word_count} words in ${result.processing_time.toFixed(1)}s`)

  } catch (error: any) {
    clearInterval(progressInterval)
    
    job.status = 'failed'
    job.error = error.message || 'Unknown error'

    socket.emit('error', { jobId, error: job.error })
    console.error(`Job ${jobId} failed:`, error)
  }
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`)

  // Start chunked upload
  socket.on('start-upload', (data: { fileName: string; fileSize: number; totalChunks: number }) => {
    const sessionId = randomUUID()
    const session: UploadSession = {
      id: sessionId,
      fileName: data.fileName,
      fileSize: data.fileSize,
      totalChunks: data.totalChunks,
      chunks: new Map(),  // Store Buffers
      createdAt: new Date()
    }
    uploadSessions.set(sessionId, session)
    
    socket.data.uploadSessionId = sessionId
    console.log(`Upload session ${sessionId} started: ${data.fileName}, ${data.fileSize} bytes, ${data.totalChunks} chunks`)
    
    const jobId = randomUUID()
    const job: TranscriptionJob = {
      id: jobId,
      status: 'pending',
      progress: 0,
      fileName: data.fileName,
      fileSize: data.fileSize
    }
    jobs.set(jobId, job)
    socket.data.jobId = jobId
    
    socket.emit('upload-started', { sessionId, jobId })
  })

  // Receive chunk
  socket.on('upload-chunk', async (data: { chunkIndex: number; chunkData: string; isLast: boolean }) => {
    const sessionId = socket.data.uploadSessionId
    if (!sessionId) {
      socket.emit('error', { error: 'No upload session' })
      return
    }

    const session = uploadSessions.get(sessionId)
    if (!session) {
      socket.emit('error', { error: 'Session not found' })
      return
    }

    // Decode base64 to Buffer and store
    const chunkBuffer = Buffer.from(data.chunkData, 'base64')
    session.chunks.set(data.chunkIndex, chunkBuffer)
    
    socket.emit('chunk-received', {
      received: session.chunks.size,
      total: session.totalChunks
    })

    // If all chunks received, combine and transcribe
    if (data.isLast && session.chunks.size === session.totalChunks) {
      console.log(`All ${session.totalChunks} chunks received for session ${sessionId}`)
      
      socket.emit('upload-complete')
      
      // Combine chunks in order
      const buffers: Buffer[] = []
      let totalSize = 0
      for (let i = 0; i < session.totalChunks; i++) {
        const chunk = session.chunks.get(i)
        if (!chunk) {
          socket.emit('error', { error: `Missing chunk ${i}` })
          return
        }
        buffers.push(chunk)
        totalSize += chunk.length
      }

      // Concatenate all buffers
      const combinedBuffer = Buffer.concat(buffers, totalSize)
      console.log(`Combined buffer size: ${combinedBuffer.length} bytes (${(combinedBuffer.length / 1024 / 1024).toFixed(2)} MB)`)

      // Clean up session
      uploadSessions.delete(sessionId)

      // Start transcription
      const jobId = socket.data.jobId
      if (jobId) {
        socket.emit('job-created', { jobId })
        transcribeWithWhisper(jobId, combinedBuffer, session.fileName, session.fileSize, socket)
      }
    }
  })

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected: ${socket.id}, reason: ${reason}`)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`ASR WebSocket proxy running on port ${PORT}`)
  console.log(`Whisper service URL: ${WHISPER_SERVICE_URL}`)
})

process.on('SIGTERM', () => {
  console.log('Shutting down...')
  httpServer.close(() => process.exit(0))
})
