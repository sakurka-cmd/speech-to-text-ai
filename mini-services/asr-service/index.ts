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
  pingTimeout: 600000,     // 10 minutes
  pingInterval: 25000,
  maxHttpBufferSize: 150e6
})

const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000'
const WHISPER_TIMEOUT = parseInt(process.env.WHISPER_TIMEOUT || '7200000', 10) // 2 hours default

interface UploadSession {
  id: string
  fileName: string
  fileSize: number
  totalChunks: number
  chunks: Map<number, Buffer>
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

// Clean old sessions
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
  }, 2000)

  return interval
}

async function transcribeWithWhisper(
  jobId: string, 
  audioBuffer: Buffer,
  fileName: string, 
  fileSize: number, 
  socket: any
) {
  const job = jobs.get(jobId)
  if (!job) return

  job.status = 'processing'
  const progressInterval = simulateProgress(jobId, socket)
  const startTime = Date.now()

  try {
    const ext = fileName.split('.').pop()?.toLowerCase() || 'wav'
    const contentTypes: Record<string, string> = {
      'wav': 'audio/wav', 'mp3': 'audio/mpeg', 'm4a': 'audio/m4a',
      'flac': 'audio/flac', 'ogg': 'audio/ogg', 'webm': 'audio/webm',
      'mp4': 'audio/mp4', 'mpeg': 'audio/mpeg', 'mpga': 'audio/mpeg'
    }
    const contentType = contentTypes[ext] || 'audio/wav'
    
    console.log(`[${jobId}] Sending ${(audioBuffer.length / 1024 / 1024).toFixed(2)} MB to Whisper...`)
    console.log(`[${jobId}] Timeout set to ${WHISPER_TIMEOUT / 1000 / 60} minutes`)

    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: contentType }), fileName)

    // Use AbortSignal.timeout for proper timeout handling
    const response = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(WHISPER_TIMEOUT)
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.detail || `HTTP ${response.status}`)
    }

    const result = await response.json()
    clearInterval(progressInterval)

    const totalTime = (Date.now() - startTime) / 1000
    
    job.progress = 100
    job.status = 'completed'
    job.transcription = result.text
    job.language = result.language
    job.wordCount = result.word_count
    job.processingTime = totalTime

    socket.emit('completed', {
      jobId,
      transcription: result.text,
      language: result.language,
      wordCount: result.word_count,
      processingTime: totalTime
    })

    console.log(`[${jobId}] Done: ${result.word_count} words in ${totalTime.toFixed(0)}s`)

  } catch (error: any) {
    clearInterval(progressInterval)
    
    job.status = 'failed'
    job.error = error.message || 'Unknown error'

    socket.emit('error', { jobId, error: job.error })
    console.error(`[${jobId}] Failed:`, error.message)
  }
}

io.on('connection', (socket) => {
  console.log(`Client: ${socket.id}`)

  socket.on('start-upload', (data: { fileName: string; fileSize: number; totalChunks: number }) => {
    const sessionId = randomUUID()
    const session: UploadSession = {
      id: sessionId,
      fileName: data.fileName,
      fileSize: data.fileSize,
      totalChunks: data.totalChunks,
      chunks: new Map(),
      createdAt: new Date()
    }
    uploadSessions.set(sessionId, session)
    socket.data.uploadSessionId = sessionId
    
    const jobId = randomUUID()
    jobs.set(jobId, {
      id: jobId,
      status: 'pending',
      progress: 0,
      fileName: data.fileName,
      fileSize: data.fileSize
    })
    socket.data.jobId = jobId
    
    socket.emit('upload-started', { sessionId, jobId })
    console.log(`Upload: ${(data.fileSize / 1024 / 1024).toFixed(2)} MB in ${data.totalChunks} chunks`)
  })

  socket.on('upload-chunk', async (data: { chunkIndex: number; chunkData: string; isLast: boolean }) => {
    const sessionId = socket.data.uploadSessionId
    if (!sessionId) return socket.emit('error', { error: 'No session' })

    const session = uploadSessions.get(sessionId)
    if (!session) return socket.emit('error', { error: 'No session' })

    session.chunks.set(data.chunkIndex, Buffer.from(data.chunkData, 'base64'))
    socket.emit('chunk-received', { received: session.chunks.size, total: session.totalChunks })

    if (data.isLast && session.chunks.size === session.totalChunks) {
      socket.emit('upload-complete')
      
      const buffers: Buffer[] = []
      for (let i = 0; i < session.totalChunks; i++) {
        const chunk = session.chunks.get(i)
        if (!chunk) return socket.emit('error', { error: `Missing chunk ${i}` })
        buffers.push(chunk)
      }

      const combined = Buffer.concat(buffers)
      uploadSessions.delete(sessionId)

      console.log(`Combined: ${(combined.length / 1024 / 1024).toFixed(2)} MB`)

      const jobId = socket.data.jobId
      if (jobId) {
        socket.emit('job-created', { jobId })
        transcribeWithWhisper(jobId, combined, session.fileName, session.fileSize, socket)
      }
    }
  })

  socket.on('disconnect', (reason) => {
    console.log(`Disconnected: ${socket.id} (${reason})`)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`ASR proxy on port ${PORT}`)
  console.log(`Whisper: ${WHISPER_SERVICE_URL}`)
  console.log(`Timeout: ${WHISPER_TIMEOUT / 1000 / 60} minutes`)
})

process.on('SIGTERM', () => httpServer.close(() => process.exit(0)))
