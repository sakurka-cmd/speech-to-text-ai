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
  WifiOff,
  AlertTriangle,
  Scissors,
  CheckCircle
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import WaveformEditor from '@/components/audio/WaveformEditor'

const CHUNK_SIZE = 1024 * 1024 // 1MB chunks

interface TranscriptionResult {
  text: string
  wordCount: number
  processingTime?: number
  language?: string
  fileName: string
  fileSize: number
}

interface AudioRegion {
  start: number
  end: number
}

type Status = 'idle' | 'connecting' | 'uploading' | 'processing' | 'completed' | 'error'

export default function Home() {
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioLoaded, setAudioLoaded] = useState(false)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioDuration, setAudioDuration] = useState(0)
  const [result, setResult] = useState<TranscriptionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [processingTime, setProcessingTime] = useState(0)
  const [selectedRegion, setSelectedRegion] = useState<AudioRegion | null>(null)
  const [trimmedBlob, setTrimmedBlob] = useState<Blob | null>(null)
  const [trimmedFileName, setTrimmedFileName] = useState<string>('')
  const [transcriptionMode, setTranscriptionMode] = useState<'full' | 'selection'>('full')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const processingStartTime = useRef<number>(0)
  const { toast } = useToast()

  // Timer for processing
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (status === 'processing' || status === 'uploading') {
      processingStartTime.current = Date.now()
      interval = setInterval(() => {
        setProcessingTime(Math.floor((Date.now() - processingStartTime.current) / 1000))
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [status])

  // Initialize WebSocket
  useEffect(() => {
    const wsUrl = typeof window !== 'undefined' ? window.location.origin : ''

    const newSocket = io(wsUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 2000,
      timeout: 60000,
    })

    newSocket.on('connect', () => {
      console.log('Connected:', newSocket.id)
      setIsConnected(true)
    })

    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason)
      setIsConnected(false)
    })

    newSocket.on('connect_error', (err) => {
      console.error('Connection error:', err.message)
      setIsConnected(false)
    })

    newSocket.on('upload-started', (data) => {
      console.log('Upload started:', data)
    })

    newSocket.on('chunk-received', (data) => {
      setUploadProgress(data.received / data.total * 100)
    })

    newSocket.on('upload-complete', () => {
      console.log('Upload complete')
      setUploadProgress(100)
    })

    newSocket.on('job-created', (data) => {
      console.log('Job created:', data)
      setStatus('processing')
      setProgress(5)
    })

    newSocket.on('progress', (data) => {
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
        title: 'Транскрипция завершена!',
        description: `Обработано ${data.wordCount} слов`,
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
    return () => { newSocket.close() }
  }, [toast, file?.name])

  // Cleanup audio URL
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
    }
  }, [audioUrl])

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins > 0) return `${mins}м ${secs}с`
    return `${secs}с`
  }

  const formatTimeShort = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleFileSelect = useCallback((selectedFile: File) => {
    const validExtensions = ['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.webm', '.mp4', '.mpeg', '.mpga', '.oga']
    const ext = '.' + selectedFile.name.split('.').pop()?.toLowerCase()
    const isValidType = selectedFile.type.startsWith('audio/') ||
      selectedFile.type.startsWith('video/') ||
      validExtensions.includes(ext)

    if (!isValidType) {
      toast({ variant: 'destructive', title: 'Неподдерживаемый формат' })
      return
    }

    if (selectedFile.size > 100 * 1024 * 1024) {
      toast({ variant: 'destructive', title: 'Максимум 100MB' })
      return
    }

    // Cleanup previous URL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }

    setFile(selectedFile)
    setAudioLoaded(false)
    setAudioLoading(true)
    setAudioDuration(0)
    setResult(null)
    setError(null)
    setStatus('idle')
    setProgress(0)
    setUploadProgress(0)
    setProcessingTime(0)
    setTrimmedBlob(null)
    setSelectedRegion(null)

    // Create object URL and get duration
    const url = URL.createObjectURL(selectedFile)
    setAudioUrl(url)

    // Get audio duration
    const audio = new Audio()
    audio.onloadedmetadata = () => {
      setAudioDuration(audio.duration)
      setAudioLoaded(true)
      setAudioLoading(false)
    }
    audio.onerror = () => {
      setAudioLoading(false)
      toast({ variant: 'destructive', title: 'Ошибка загрузки аудио' })
    }
    audio.src = url
  }, [audioUrl, toast])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0])
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleRegionChange = useCallback((start: number, end: number) => {
    setSelectedRegion({ start, end })
  }, [])

  const handleTrimmedAudio = useCallback((blob: Blob, start: number, end: number) => {
    setTrimmedBlob(blob)
    const baseName = file?.name.replace(/\.[^/.]+$/, '') || 'audio'
    setTrimmedFileName(`${baseName}_${formatTimeShort(start)}-${formatTimeShort(end)}.mp3`)

    // Create URL for trimmed audio
    const url = URL.createObjectURL(blob)
    setAudioUrl(url)
    setFile(new File([blob], `${baseName}_trimmed.mp3`, { type: 'audio/mp3' }))

    // Reset region for new file
    setSelectedRegion(null)

    toast({
      title: 'Аудио обрезано',
      description: `Создан файл ${formatTimeShort(start)}-${formatTimeShort(end)}`,
    })
  }, [file?.name, toast])

  const handleTranscribe = async () => {
    if (!socket || !isConnected) return

    let fileToTranscribe: File | null = file
    let fileSize = file?.size || 0

    // If mode is selection and we have a trimmed blob, use that
    if (transcriptionMode === 'selection' && trimmedBlob) {
      fileToTranscribe = new File([trimmedBlob], trimmedFileName || 'trimmed.mp3', { type: 'audio/mp3' })
      fileSize = trimmedBlob.size
    }

    if (!fileToTranscribe) return

    setStatus('uploading')
    setProgress(0)
    setUploadProgress(0)
    setError(null)

    try {
      const arrayBuffer = await fileToTranscribe.arrayBuffer()
      const totalSize = arrayBuffer.byteLength
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)

      console.log(`File: ${totalSize} bytes, ${totalChunks} chunks`)

      socket.emit('start-upload', {
        fileName: fileToTranscribe.name,
        fileSize: totalSize,
        totalChunks: totalChunks
      })

      // Wait a bit for session to be created
      await new Promise(r => setTimeout(r, 100))

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, totalSize)
        const chunk = arrayBuffer.slice(start, end)
        const bytes = new Uint8Array(chunk)
        let binary = ''
        for (let j = 0; j < bytes.length; j++) {
          binary += String.fromCharCode(bytes[j])
        }
        const chunkBase64 = btoa(binary)

        socket.emit('upload-chunk', {
          chunkIndex: i,
          chunkData: chunkBase64,
          isLast: i === totalChunks - 1
        })

        setUploadProgress((i + 1) / totalChunks * 100)

        if (i < totalChunks - 1) {
          await new Promise(r => setTimeout(r, 50))
        }
      }

      console.log('All chunks sent')

    } catch (err: any) {
      setStatus('error')
      setError(err.message)
      toast({ variant: 'destructive', title: 'Ошибка', description: err.message })
    }
  }

  const handleCopy = () => {
    if (result?.text) {
      navigator.clipboard.writeText(result.text)
      toast({ title: 'Скопировано' })
    }
  }

  const handleDownload = () => {
    if (result?.text) {
      const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `transcription_${file?.name?.replace(/\.[^/.]+$/, '') || 'audio'}.txt`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const handleDownloadTrimmed = () => {
    if (trimmedBlob) {
      const url = URL.createObjectURL(trimmedBlob)
      const a = document.createElement('a')
      a.href = url
      a.download = trimmedFileName || 'trimmed.mp3'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const handleReset = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    setFile(null)
    setAudioUrl(null)
    setAudioLoaded(false)
    setAudioLoading(false)
    setAudioDuration(0)
    setResult(null)
    setError(null)
    setStatus('idle')
    setProgress(0)
    setUploadProgress(0)
    setProcessingTime(0)
    setTrimmedBlob(null)
    setSelectedRegion(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Estimate processing time based on file size
  const estimatedTime = file ? Math.ceil(file.size / (1024 * 1024) * 0.5) : 0

  // Calculate region duration
  const regionDuration = selectedRegion ? selectedRegion.end - selectedRegion.start : 0
  const isRegionValid = regionDuration > 0.5 // At least 0.5 seconds

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
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
          <p className="text-slate-400 text-lg">Распознавание речи с Whisper AI</p>
          <div className="flex items-center justify-center gap-2 mt-3">
            {isConnected ? (
              <Badge className="bg-emerald-500/20 text-emerald-400">
                <Wifi className="w-3 h-3 mr-1" /> Подключено
              </Badge>
            ) : (
              <Badge className="bg-yellow-500/20 text-yellow-400">
                <WifiOff className="w-3 h-3 mr-1" /> Подключение...
              </Badge>
            )}
          </div>
        </div>

        {/* Warning for large files */}
        {file && file.size > 20 * 1024 * 1024 && status === 'idle' && (
          <Alert className="bg-yellow-500/10 border-yellow-500/50 mb-6">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
            <AlertDescription className="text-yellow-300">
              Большой файл (~{formatFileSize(file.size)}). Обработка займёт примерно {estimatedTime} минут.
              Не закрывайте страницу во время обработки.
            </AlertDescription>
          </Alert>
        )}

        {/* Upload Area */}
        <Card className="bg-slate-800/50 border-slate-700 mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-400" />
              Аудиофайл
            </CardTitle>
            <CardDescription className="text-slate-400">
              WAV, MP3, M4A, FLAC, OGG, WebM, MP4 (до 100MB)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all
            ${isDragging ? 'border-emerald-400 bg-emerald-500/10' : 'border-slate-600 hover:border-slate-500'}
            ${audioLoaded ? 'border-emerald-500/50 bg-emerald-500/5' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => !audioLoading && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,video/webm,video/mp4,.wav,.mp3,.m4a,.flac,.ogg,.webm,.mp4"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />

              {audioLoading ? (
                <div className="space-y-3">
                  <Loader2 className="w-10 h-10 text-emerald-400 mx-auto animate-spin" />
                  <p className="text-white font-medium">Загрузка аудио...</p>
                </div>
              ) : audioLoaded && file ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                    <div className="text-left">
                      <p className="text-white font-medium">{file.name}</p>
                      <p className="text-slate-400 text-sm">{formatFileSize(file.size)} • {formatDuration(audioDuration)}</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleReset()
                    }}
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Другой файл
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Upload className="w-10 h-10 text-slate-400 mx-auto" />
                  <p className="text-white font-medium">Перетащите файл сюда</p>
                  <p className="text-slate-400 text-sm">или нажмите для выбора</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Waveform Editor - shows when file is loaded */}
        {audioUrl && (
          <Card className="bg-slate-800/50 border-slate-700 mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-white flex items-center gap-2">
                <Scissors className="w-5 h-5 text-emerald-400" />
                Редактор
              </CardTitle>
              <CardDescription className="text-slate-400">
                Прослушайте аудио и выберите участок для распознавания
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WaveformEditor
                audioFile={file}
                audioUrl={audioUrl}
                onRegionChange={handleRegionChange}
                onTrimmedAudio={handleTrimmedAudio}
                onLoadingChange={setAudioLoading}
                onLoadedChange={setAudioLoaded}
              />
            </CardContent>
          </Card>
        )}

        {/* Trimmed audio info */}
        {trimmedBlob && (
          <Alert className="bg-emerald-500/10 border-emerald-500/50 mb-6">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <AlertDescription className="text-emerald-300 flex items-center justify-between">
              <span>Вырезанный фрагмент: {formatFileSize(trimmedBlob.size)} ({trimmedFileName})</span>
              <Button variant="link" size="sm" onClick={handleDownloadTrimmed} className="text-emerald-400">
                <Download className="w-4 h-4 mr-1" /> Скачать
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Transcription Controls - shows when file is loaded and idle */}
        {audioLoaded && status === 'idle' && (
          <Card className="bg-slate-800/50 border-slate-700 mb-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-white flex items-center gap-2">
                <Mic className="w-5 h-5 text-emerald-400" />
                Распознавание
              </CardTitle>
              <CardDescription className="text-slate-400">
                Выберите что распознать: весь файл или только выбранный участок
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  variant={transcriptionMode === 'full' ? 'default' : 'outline'}
                  onClick={() => setTranscriptionMode('full')}
                  className={`h-auto py-4 justify-start ${transcriptionMode === 'full' ? 'bg-emerald-500 hover:bg-emerald-600' : 'border-slate-600 hover:bg-slate-700'}`}
                >
                  <div className="flex items-center gap-3">
                    <FileAudio className="w-6 h-6" />
                    <div className="text-left">
                      <div className="font-medium">Весь файл</div>
                      <div className="text-xs opacity-70">
                        {formatFileSize(file?.size || 0)} • {formatDuration(audioDuration)}
                      </div>
                    </div>
                  </div>
                </Button>
                <Button
                  variant={transcriptionMode === 'selection' ? 'default' : 'outline'}
                  onClick={() => setTranscriptionMode('selection')}
                  disabled={!isRegionValid && !trimmedBlob}
                  className={`h-auto py-4 justify-start ${transcriptionMode === 'selection' ? 'bg-emerald-500 hover:bg-emerald-600' : 'border-slate-600 hover:bg-slate-700'}`}
                >
                  <div className="flex items-center gap-3">
                    <Scissors className="w-6 h-6" />
                    <div className="text-left">
                      <div className="font-medium">Выбранный участок</div>
                      <div className="text-xs opacity-70">
                        {selectedRegion && isRegionValid
                          ? `${formatTimeShort(selectedRegion.start)} - ${formatTimeShort(selectedRegion.end)} (${formatDuration(regionDuration)})`
                          : trimmedBlob
                            ? `${formatFileSize(trimmedBlob.size)} (вырезан)`
                            : 'Выберите участок на波形'}
                      </div>
                    </div>
                  </div>
                </Button>
              </div>

              <Button
                onClick={handleTranscribe}
                disabled={!isConnected || (transcriptionMode === 'selection' && !trimmedBlob && !isRegionValid)}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 py-6 text-lg"
              >
                <Mic className="w-5 h-5 mr-2" />
                Распознать {transcriptionMode === 'selection' ? 'выбранный участок' : 'весь файл'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Progress */}
        {(status === 'uploading' || status === 'processing') && (
          <Card className="bg-slate-800/50 border-slate-700 mb-6">
            <CardContent className="pt-6">
              <div className="space-y-4">
                {/* Timer */}
                <div className="flex items-center justify-center gap-2 text-2xl font-mono text-emerald-400">
                  <Clock className="w-6 h-6" />
                  {formatTime(processingTime)}
                </div>

                {/* Upload progress */}
                {uploadProgress < 100 && (
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-400">Отправка файла</span>
                      <span className="text-emerald-400">{Math.round(uploadProgress)}%</span>
                    </div>
                    <Progress value={uploadProgress} className="h-2" />
                  </div>
                )}

                {/* Processing progress */}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-400">Распознавание</span>
                    <span className="text-emerald-400">{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-3" />
                </div>

                <p className="text-center text-slate-400 text-sm">
                  {progress < 20 && 'Анализ аудио...'}
                  {progress >= 20 && progress < 50 && 'Распознавание речи...'}
                  {progress >= 50 && progress < 80 && 'Обработка текста...'}
                  {progress >= 80 && 'Почти готово...'}
                </p>

                <p className="text-center text-yellow-400 text-xs">
                  ⏱ Не закрывайте страницу. Обработка может занять до 30 минут для больших файлов.
                </p>
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
          <Card className="bg-slate-800/50 border-slate-700">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  Результат ({result.wordCount} слов)
                </CardTitle>
                <div className="flex gap-2">
                  <Button onClick={handleCopy} variant="outline" size="sm">
                    <Copy className="w-4 h-4 mr-1" /> Копировать
                  </Button>
                  <Button onClick={handleDownload} variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-1" /> Скачать
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge variant="secondary">
                  <FileText className="w-3 h-3 mr-1" /> {result.wordCount} слов
                </Badge>
                <Badge variant="secondary">
                  <FileAudio className="w-3 h-3 mr-1" /> {formatFileSize(result.fileSize)}
                </Badge>
                {result.processingTime && (
                  <Badge variant="secondary">
                    <Clock className="w-3 h-3 mr-1" /> {formatTime(Math.round(result.processingTime))}
                  </Badge>
                )}
                {result.language && (
                  <Badge variant="secondary">Язык: {result.language}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                value={result.text}
                readOnly
                className="min-h-[200px] bg-slate-900/50 border-slate-600 text-white"
              />
            </CardContent>
          </Card>
        )}

        <p className="text-center mt-8 text-slate-500 text-sm">
          Powered by OpenAI Whisper
        </p>
      </div>
    </div>
  )
}
