'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { 
  Mic, 
  Upload, 
  FileAudio, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Copy, 
  Download,
  Trash2,
  Clock,
  FileText,
  Wifi,
  WifiOff
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

// Chunk size: 1MB per chunk
const CHUNK_SIZE = 1024 * 1024

interface TranscriptionResult {
  text: string
  wordCount: number
  processingTime?: number
  language?: string
  fileName: string
  fileSize: number
}

type Status = 'idle' | 'connecting' | 'uploading' | 'processing' | 'completed' | 'error'

export default function Home() {
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  // Initialize WebSocket connection
  useEffect(() => {
    const wsUrl = typeof window !== 'undefined' ? window.location.origin : ''
    
    console.log('Connecting to WebSocket:', wsUrl)

    const newSocket = io(wsUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 30000,
      maxHttpBufferSize: 150 * 1024 * 1024, // 150MB max
    })

    newSocket.on('connect', () => {
      console.log('Connected to ASR service, socket id:', newSocket.id)
      setIsConnected(true)
    })

    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected from ASR service:', reason)
      setIsConnected(false)
    })

    newSocket.on('connect_error', (err) => {
      console.error('WebSocket connection error:', err.message)
      setIsConnected(false)
    })

    newSocket.on('job-created', (data) => {
      console.log('Job created:', data)
      setStatus('processing')
      setProgress(5)
    })

    newSocket.on('chunk-received', (data) => {
      setUploadProgress(data.received / data.total * 100)
    })

    newSocket.on('upload-complete', () => {
      console.log('Upload complete, starting transcription...')
      setUploadProgress(100)
    })

    newSocket.on('progress', (data) => {
      setProgress(Math.round(data.progress))
    })

    newSocket.on('completed', (data) => {
      setProgress(100)
      setStatus('completed')
      setResult({
        text: data.transcription,
        wordCount: data.wordCount,
        processingTime: data.processingTime,
        language: data.language,
        fileName: file?.name || 'audio.wav',
        fileSize: file?.size || 0
      })
      toast({
        title: 'Транскрипция завершена',
        description: `Обработано ${data.wordCount} слов за ${((data.processingTime || 0) / 1000).toFixed(1)}с`,
      })
    })

    newSocket.on('error', (data) => {
      setStatus('error')
      setError(data.error)
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: data.error,
      })
    })

    setSocket(newSocket)

    return () => {
      newSocket.close()
    }
  }, [toast])

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes > 0) {
      return `${minutes}м ${remainingSeconds}с`
    }
    return `${remainingSeconds}с`
  }

  const handleFileSelect = useCallback((selectedFile: File) => {
    const validExtensions = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.mp4', '.mpeg', '.mpga', '.oga']
    const ext = '.' + selectedFile.name.split('.').pop()?.toLowerCase()
    const isValidType = selectedFile.type.startsWith('audio/') || 
                        selectedFile.type.startsWith('video/') ||
                        validExtensions.includes(ext)

    if (!isValidType) {
      toast({
        variant: 'destructive',
        title: 'Неподдерживаемый формат',
        description: 'Поддерживаются: WAV, MP3, M4A, FLAC, OGG, WebM, MP4',
      })
      return
    }

    if (selectedFile.size > 100 * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'Файл слишком большой',
        description: 'Максимальный размер файла: 100MB',
      })
      return
    }

    setFile(selectedFile)
    setResult(null)
    setError(null)
    setStatus('idle')
    setProgress(0)
    setUploadProgress(0)
  }, [toast])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      handleFileSelect(droppedFile)
    }
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  // File to base64 chunk (browser-compatible)
  const fileChunkToBase64 = (arrayBuffer: ArrayBuffer, start: number, end: number): string => {
    const chunk = arrayBuffer.slice(start, end)
    const bytes = new Uint8Array(chunk)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  const handleTranscribe = async () => {
    if (!file || !socket || !isConnected) return

    setStatus('uploading')
    setProgress(0)
    setUploadProgress(0)
    setError(null)

    try {
      // Read entire file
      const arrayBuffer = await file.arrayBuffer()
      const totalSize = arrayBuffer.byteLength
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
      
      console.log(`File size: ${totalSize}, chunks: ${totalChunks}`)

      // Send init message
      socket.emit('start-upload', {
        fileName: file.name,
        fileSize: totalSize,
        totalChunks: totalChunks
      })

      // Send chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, totalSize)
        const chunkBase64 = fileChunkToBase64(arrayBuffer, start, end)
        
        socket.emit('upload-chunk', {
          chunkIndex: i,
          chunkData: chunkBase64,
          isLast: i === totalChunks - 1
        })

        setUploadProgress((i + 1) / totalChunks * 100)
        
        // Small delay between chunks to prevent overwhelming
        if (i < totalChunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 10))
        }
      }

      console.log('All chunks sent')

    } catch (err: any) {
      setStatus('error')
      setError(err.message || 'Ошибка при чтении файла')
      toast({
        variant: 'destructive',
        title: 'Ошибка',
        description: err.message || 'Ошибка при чтении файла',
      })
    }
  }

  const handleCopy = () => {
    if (result?.text) {
      navigator.clipboard.writeText(result.text)
      toast({ title: 'Скопировано', description: 'Текст скопирован' })
    }
  }

  const handleDownload = () => {
    if (result?.text) {
      const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `transcription_${file?.name?.replace(/\.[^/.]+$/, '') || 'audio'}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  }

  const handleReset = () => {
    setFile(null)
    setResult(null)
    setError(null)
    setStatus('idle')
    setProgress(0)
    setUploadProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="p-3 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl shadow-lg">
              <Mic className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
              Speech to Text
            </h1>
          </div>
          <p className="text-slate-400 text-lg">
            Распознавание речи из аудиофайлов с использованием Whisper AI
          </p>
          <div className="flex items-center justify-center gap-2 mt-3">
            {isConnected ? (
              <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                <Wifi className="w-3 h-3 mr-1" />
                Сервер подключен
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                <WifiOff className="w-3 h-3 mr-1" />
                Подключение...
              </Badge>
            )}
          </div>
        </div>

        {/* Upload Area */}
        <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-400" />
              Загрузка файла
            </CardTitle>
            <CardDescription className="text-slate-400">
              Поддерживаемые форматы: WAV, MP3, M4A, FLAC, OGG, WebM, MP4 (до 100MB)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer
                ${isDragging ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/30'}
                ${file ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/webm,video/mp4,.wav,.mp3,.m4a,.flac,.ogg,.webm,.mp4"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />
              
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileAudio className="w-12 h-12 text-emerald-400" />
                  <div className="text-left">
                    <p className="text-white font-medium">{file.name}</p>
                    <p className="text-slate-400 text-sm">{formatFileSize(file.size)}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-center">
                    <div className="p-4 bg-slate-700/50 rounded-full">
                      <Upload className="w-8 h-8 text-slate-400" />
                    </div>
                  </div>
                  <div>
                    <p className="text-white font-medium">Перетащите файл сюда</p>
                    <p className="text-slate-400 text-sm">или нажмите для выбора</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-4">
              <Button
                onClick={handleTranscribe}
                disabled={!file || status === 'processing' || status === 'uploading' || !isConnected}
                className="flex-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-medium py-6 text-lg shadow-lg shadow-emerald-500/25 disabled:opacity-50"
              >
                {status === 'uploading' || status === 'processing' ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Обработка...
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5 mr-2" />
                    Распознать речь
                  </>
                )}
              </Button>
              
              {file && (
                <Button
                  onClick={handleReset}
                  variant="outline"
                  className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  disabled={status === 'processing' || status === 'uploading'}
                >
                  <Trash2 className="w-5 h-5" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Upload Progress */}
        {status === 'uploading' && uploadProgress < 100 && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm mb-6">
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-medium">Отправка файла</span>
                  <span className="text-emerald-400 font-bold">{Math.round(uploadProgress)}%</span>
                </div>
                <Progress value={uploadProgress} className="h-2 bg-slate-700" />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Processing Progress */}
        {(status === 'processing') && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm mb-6">
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-medium">Распознавание речи</span>
                  <span className="text-emerald-400 font-bold">{progress}%</span>
                </div>
                <Progress value={progress} className="h-3 bg-slate-700 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-500" />
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {progress < 20 && 'Загрузка аудио...'}
                    {progress >= 20 && progress < 50 && 'Анализ речи...'}
                    {progress >= 50 && progress < 80 && 'Распознавание текста...'}
                    {progress >= 80 && 'Финальная обработка...'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {status === 'error' && error && (
          <Alert className="bg-red-500/10 border-red-500/50 mb-6">
            <XCircle className="w-5 h-5 text-red-400" />
            <AlertDescription className="text-red-300">{error}</AlertDescription>
          </Alert>
        )}

        {/* Results */}
        {status === 'completed' && result && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  Результат транскрипции
                </CardTitle>
                <div className="flex gap-2">
                  <Button onClick={handleCopy} variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700">
                    <Copy className="w-4 h-4 mr-1" /> Копировать
                  </Button>
                  <Button onClick={handleDownload} variant="outline" size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700">
                    <Download className="w-4 h-4 mr-1" /> Скачать
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary" className="bg-slate-700 text-slate-300">
                  <FileText className="w-3 h-3 mr-1" /> {result.wordCount} слов
                </Badge>
                <Badge variant="secondary" className="bg-slate-700 text-slate-300">
                  <FileAudio className="w-3 h-3 mr-1" /> {formatFileSize(result.fileSize)}
                </Badge>
                {result.processingTime && (
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300">
                    <Clock className="w-3 h-3 mr-1" /> {formatTime(result.processingTime)}
                  </Badge>
                )}
                {result.language && (
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300">
                    Язык: {result.language}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Textarea value={result.text} readOnly className="min-h-[200px] bg-slate-900/50 border-slate-600 text-white resize-y" />
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center mt-12 text-slate-500 text-sm">
          <p>Powered by OpenAI Whisper</p>
        </div>
      </div>
    </div>
  )
}
