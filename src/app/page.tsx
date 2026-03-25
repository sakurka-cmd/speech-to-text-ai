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
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  // File to base64 (browser-compatible)
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        resolve(btoa(binary))
      }
      reader.onerror = reject
      reader.readAsArrayBuffer(file)
    })
  }

  // Initialize WebSocket connection
  useEffect(() => {
    // Get WebSocket URL - use same host but port 3013
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:'
    const wsUrl = `${protocol}//${hostname}:3013`
    
    console.log('Connecting to WebSocket:', wsUrl)

    const newSocket = io(wsUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
      withCredentials: false,
    })

    newSocket.on('connect', () => {
      console.log('Connected to ASR service, socket id:', newSocket.id)
      setIsConnected(true)
      setStatus('idle')
    })

    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected from ASR service:', reason)
      setIsConnected(false)
    })

    newSocket.on('connect_error', (err) => {
      console.error('WebSocket connection error:', err.message)
      setIsConnected(false)
    })

    newSocket.on('reconnect', (attemptNumber) => {
      console.log('Reconnected after', attemptNumber, 'attempts')
      setIsConnected(true)
    })

    newSocket.on('reconnect_error', (err) => {
      console.error('Reconnection error:', err.message)
    })

    newSocket.on('job-created', (data) => {
      console.log('Job created:', data)
      setStatus('processing')
      setProgress(5)
    })

    newSocket.on('progress', (data) => {
      console.log('Progress:', data.progress)
      setProgress(Math.round(data.progress))
    })

    newSocket.on('completed', (data) => {
      console.log('Completed:', data)
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
      console.error('Server error:', data)
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
      console.log('Cleaning up socket connection')
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
    // Validate file type
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

    // Validate file size (max 100MB)
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

  const handleTranscribe = async () => {
    if (!file) return

    // Check WebSocket connection
    if (!socket || !isConnected) {
      toast({
        variant: 'destructive',
        title: 'Нет подключения',
        description: 'Ожидание подключения к серверу... Попробуйте обновить страницу.',
      })
      return
    }

    setStatus('uploading')
    setProgress(0)
    setError(null)

    try {
      console.log('Converting file to base64:', file.name, file.size)
      
      // Convert file to base64 (browser-compatible)
      const base64Audio = await fileToBase64(file)
      
      console.log('Sending to server, base64 length:', base64Audio.length)

      // Send via WebSocket
      socket.emit('start-transcription', {
        fileName: file.name,
        fileSize: file.size,
        base64Audio
      })

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
      toast({
        title: 'Скопировано',
        description: 'Текст транскрипции скопирован в буфер обмена',
      })
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
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
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
              className={`
                relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer
                ${isDragging 
                  ? 'border-emerald-400 bg-emerald-500/10' 
                  : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/30'}
                ${file ? 'border-emerald-500/50 bg-emerald-500/5' : ''}
              `}
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
                <div className="space-y-3">
                  <div className="flex items-center justify-center gap-3">
                    <FileAudio className="w-12 h-12 text-emerald-400" />
                    <div className="text-left">
                      <p className="text-white font-medium">{file.name}</p>
                      <p className="text-slate-400 text-sm">{formatFileSize(file.size)}</p>
                    </div>
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

            {/* Action Buttons */}
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

        {/* Progress Section */}
        {(status === 'uploading' || status === 'processing') && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm mb-6">
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300 font-medium">Прогресс обработки</span>
                  <span className="text-emerald-400 font-bold">{progress}%</span>
                </div>
                <Progress 
                  value={progress} 
                  className="h-3 bg-slate-700 [&>div]:bg-gradient-to-r [&>div]:from-emerald-500 [&>div]:to-teal-500"
                />
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {progress < 20 && 'Отправка файла...'}
                    {progress >= 20 && progress < 40 && 'Загрузка аудио...'}
                    {progress >= 40 && progress < 70 && 'Распознавание речи...'}
                    {progress >= 70 && progress < 90 && 'Обработка текста...'}
                    {progress >= 90 && 'Финальная обработка...'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error Alert */}
        {status === 'error' && error && (
          <Alert className="bg-red-500/10 border-red-500/50 mb-6">
            <XCircle className="w-5 h-5 text-red-400" />
            <AlertDescription className="text-red-300">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Results Section */}
        {status === 'completed' && result && (
          <Card className="bg-slate-800/50 border-slate-700 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  Результат транскрипции
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    size="sm"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    <Copy className="w-4 h-4 mr-1" />
                    Копировать
                  </Button>
                  <Button
                    onClick={handleDownload}
                    variant="outline"
                    size="sm"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Скачать
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary" className="bg-slate-700 text-slate-300">
                  <FileText className="w-3 h-3 mr-1" />
                  {result.wordCount} слов
                </Badge>
                <Badge variant="secondary" className="bg-slate-700 text-slate-300">
                  <FileAudio className="w-3 h-3 mr-1" />
                  {formatFileSize(result.fileSize)}
                </Badge>
                {result.processingTime && (
                  <Badge variant="secondary" className="bg-slate-700 text-slate-300">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatTime(result.processingTime)}
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
              <Textarea
                value={result.text}
                readOnly
                className="min-h-[200px] bg-slate-900/50 border-slate-600 text-white resize-y"
                placeholder="Транскрипция появится здесь..."
              />
            </CardContent>
          </Card>
        )}

        {/* Features Section */}
        {status === 'idle' && !file && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            <Card className="bg-slate-800/30 border-slate-700/50">
              <CardContent className="pt-6 text-center">
                <div className="p-3 bg-emerald-500/20 rounded-full w-fit mx-auto mb-3">
                  <Mic className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-white font-medium mb-2">OpenAI Whisper</h3>
                <p className="text-slate-400 text-sm">
                  Локальная модель без внешних API и токенов
                </p>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-800/30 border-slate-700/50">
              <CardContent className="pt-6 text-center">
                <div className="p-3 bg-teal-500/20 rounded-full w-fit mx-auto mb-3">
                  <Clock className="w-6 h-6 text-teal-400" />
                </div>
                <h3 className="text-white font-medium mb-2">Прогресс в реальном времени</h3>
                <p className="text-slate-400 text-sm">
                  Отслеживайте статус обработки файла
                </p>
              </CardContent>
            </Card>
            
            <Card className="bg-slate-800/30 border-slate-700/50">
              <CardContent className="pt-6 text-center">
                <div className="p-3 bg-cyan-500/20 rounded-full w-fit mx-auto mb-3">
                  <FileAudio className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-white font-medium mb-2">До 100MB</h3>
                <p className="text-slate-400 text-sm">
                  Поддержка больших аудиофайлов
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12 text-slate-500 text-sm">
          <p>Powered by OpenAI Whisper</p>
        </div>
      </div>
    </div>
  )
}
