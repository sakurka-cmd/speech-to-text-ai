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
  pingTimeout: 300000,
  pingInterval: 25000,
  maxHttpBufferSize: 100e6,
  transports: ['websocket', 'polling']
})

// Whisper service URL
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000'

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
  startTime?: Date
  endTime?: Date
}

const jobs = new Map<string, TranscriptionJob>()

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

    if (currentJob.progress < 85) {
      const increment = Math.random() * 3 + 1
      currentJob.progress = Math.min(85, currentJob.progress + increment)
      
      let statusText = 'Загрузка аудио...'
      if (currentJob.progress >= 30) statusText = 'Анализ речи...'
      if (currentJob.progress >= 60) statusText = 'Распознавание текста...'
      if (currentJob.progress >= 80) statusText = 'Финальная обработка...'
      
      socket.emit('progress', {
        jobId,
        progress: currentJob.progress,
        status: statusText
      })
    }
  }, 500)

  return interval
}

async function transcribeWithWhisper(
  jobId: string, 
  base64Audio: string, 
  fileName: string, 
  fileSize: number, 
  socket: any
) {
  const job = jobs.get(jobId)
  if (!job) return

  job.status = 'processing'
  job.startTime = new Date()
  const progressInterval = simulateProgress(jobId, socket)

  try {
    const audioBuffer = Buffer.from(base64Audio, 'base64')
    const ext = fileName.split('.').pop()?.toLowerCase() || 'wav'
    
    const contentTypes: Record<string, string> = {
      'wav': 'audio/wav',
      'mp3': 'audio/mpeg',
      'm4a': 'audio/m4a',
      'flac': 'audio/flac',
      'ogg': 'audio/ogg',
      'webm': 'audio/webm',
      'mp4': 'audio/mp4',
      'mpeg': 'audio/mpeg',
      'mpga': 'audio/mpeg',
      'oga': 'audio/ogg'
    }
    
    const contentType = contentTypes[ext] || 'audio/wav'

    console.log(`Sending ${audioBuffer.length} bytes to Whisper service...`)

    const formData = new FormData()
    const blob = new Blob([audioBuffer], { type: contentType })
    formData.append('file', blob, fileName)

    const response = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `Whisper service error: ${response.status}`)
    }

    const result = await response.json()
    
    clearInterval(progressInterval)

    job.progress = 100
    job.status = 'completed'
    job.transcription = result.text
    job.language = result.language
    job.wordCount = result.word_count
    job.processingTime = result.processing_time
    job.endTime = new Date()

    socket.emit('completed', {
      jobId,
      transcription: result.text,
      language: result.language,
      wordCount: result.word_count,
      processingTime: result.processing_time
    })

    console.log(`Job ${jobId} completed: ${result.word_count} words in ${result.processing_time.toFixed(2)}s`)

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
    console.log(`Received transcription request: ${fileName}, ${fileSize} bytes`)

    if (fileSize > 100 * 1024 * 1024) {
      socket.emit('error', {
        error: 'Файл слишком большой. Максимальный размер: 100MB.'
      })
      return
    }

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

    transcribeWithWhisper(jobId, base64Audio, fileName, fileSize, socket)
  })

  socket.on('get-job-status', (data: { jobId: string }) => {
    const job = jobs.get(data.jobId)
    if (job) {
      socket.emit('job-status', {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        transcription: job.transcription,
        wordCount: job.wordCount,
        language: job.language,
        error: job.error
      })
    } else {
      socket.emit('error', {
        error: 'Задача не найдена'
      })
    }
  })

  socket.on('disconnect', (reason) => {
    console.log(`Client disconnected: ${socket.id}, reason: ${reason}`)
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`ASR WebSocket proxy running on port ${PORT}`)
  console.log(`Whisper service URL: ${WHISPER_SERVICE_URL}`)
})

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
