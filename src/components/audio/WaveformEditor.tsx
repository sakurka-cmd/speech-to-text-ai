'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Scissors,
  RotateCcw,
  Volume2,
  VolumeX,
  Loader2,
  CheckCircle,
  AlertCircle
} from 'lucide-react'

interface WaveformEditorProps {
  audioFile: File | null
  audioUrl: string | null
  onRegionChange?: (start: number, end: number) => void
  onTrimmedAudio?: (blob: Blob, start: number, end: number) => void
  onLoadingChange?: (loading: boolean) => void
  onLoadedChange?: (loaded: boolean) => void
}

interface AudioRegion {
  start: number
  end: number
}

// Store lamejs module reference
let lamejsModule: any = null

export default function WaveformEditor({
  audioFile,
  audioUrl,
  onRegionChange,
  onTrimmedAudio,
  onLoadingChange,
  onLoadedChange
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioBufferRef = useRef<AudioBuffer | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [zoomOffset, setZoomOffset] = useState(0)
  const [region, setRegion] = useState<AudioRegion | null>(null)
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'move' | null>(null)
  const [waveformData, setWaveformData] = useState<number[]>([])
  const [isMuted, setIsMuted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [isEncoding, setIsEncoding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)

  // Load lamejs dynamically
  useEffect(() => {
    if (!lamejsModule) {
      import('lamejs').then((module) => {
        lamejsModule = module.default || module
        console.log('lamejs loaded successfully')
      }).catch((err) => {
        console.error('Failed to load lamejs:', err)
        setError('Не удалось загрузить кодировщик MP3')
      })
    }
  }, [])

  // Notify parent of loading state changes
  useEffect(() => {
    onLoadingChange?.(isLoading)
  }, [isLoading, onLoadingChange])

  useEffect(() => {
    onLoadedChange?.(isReady)
  }, [isReady, onLoadedChange])

  // Load and decode audio
  useEffect(() => {
    if (!audioUrl) {
      setWaveformData([])
      setDuration(0)
      setCurrentTime(0)
      setRegion(null)
      setLoadProgress(0)
      setIsReady(false)
      setError(null)
      audioBufferRef.current = null
      return
    }

    const loadAudio = async () => {
      setIsLoading(true)
      setLoadProgress(0)
      setIsReady(false)
      setError(null)

      try {
        setLoadProgress(10)

        const response = await fetch(audioUrl)
        setLoadProgress(20)

        const arrayBuffer = await response.arrayBuffer()
        setLoadProgress(40)

        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
        }

        setLoadProgress(50)
        const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer)
        audioBufferRef.current = audioBuffer
        setLoadProgress(70)

        // Generate waveform data
        const channelData = audioBuffer.getChannelData(0)
        const samples = 200
        const blockSize = Math.floor(channelData.length / samples)
        const waveform: number[] = []

        for (let i = 0; i < samples; i++) {
          let sum = 0
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(channelData[i * blockSize + j])
          }
          waveform.push(sum / blockSize)
        }

        setLoadProgress(90)

        const max = Math.max(...waveform)
        const normalized = waveform.map(v => max > 0 ? v / max : 0)

        setWaveformData(normalized)
        setDuration(audioBuffer.duration)
        setCurrentTime(0)
        setRegion({ start: 0, end: audioBuffer.duration })

        setLoadProgress(100)
        setIsReady(true)

      } catch (err) {
        console.error('Error loading audio:', err)
        setError('Ошибка загрузки аудио')
      } finally {
        setIsLoading(false)
      }
    }

    loadAudio()
  }, [audioUrl])

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || waveformData.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const width = rect.width
    const height = rect.height

    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, width, height)

    const visibleSamples = Math.ceil(waveformData.length / zoom)
    const startSample = Math.floor(zoomOffset * (waveformData.length - visibleSamples))

    const barWidth = width / visibleSamples
    const gradient = ctx.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, '#10b981')
    gradient.addColorStop(0.5, '#34d399')
    gradient.addColorStop(1, '#10b981')

    ctx.fillStyle = gradient

    for (let i = 0; i < visibleSamples; i++) {
      const dataIndex = startSample + i
      if (dataIndex >= waveformData.length) break

      const value = waveformData[dataIndex]
      const barHeight = value * height * 0.8
      const x = i * barWidth
      const y = (height - barHeight) / 2

      ctx.fillRect(x, y, Math.max(1, barWidth - 1), barHeight)
    }

    if (region && duration > 0) {
      const startX = ((region.start / duration) * width - zoomOffset * width) * zoom
      const endX = ((region.end / duration) * width - zoomOffset * width) * zoom
      const regionWidth = Math.max(0, endX - startX)

      ctx.fillStyle = 'rgba(16, 185, 129, 0.3)'
      ctx.fillRect(startX, 0, regionWidth, height)

      ctx.strokeStyle = '#10b981'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(startX, 0)
      ctx.lineTo(startX, height)
      ctx.moveTo(endX, 0)
      ctx.lineTo(endX, height)
      ctx.stroke()

      ctx.fillStyle = '#10b981'
      ctx.fillRect(startX - 4, 0, 8, height)
      ctx.fillRect(endX - 4, 0, 8, height)
    }

    if (duration > 0) {
      const playheadX = ((currentTime / duration) * width - zoomOffset * width) * zoom
      ctx.strokeStyle = '#f43f5e'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, height)
      ctx.stroke()
    }

    ctx.fillStyle = '#94a3b8'
    ctx.font = '11px monospace'
    const markerInterval = getMarkerInterval(duration / zoom)
    for (let t = 0; t <= duration; t += markerInterval) {
      const x = ((t / duration) * width - zoomOffset * width) * zoom
      if (x >= 0 && x <= width) {
        ctx.fillRect(x, height - 15, 1, 10)
        ctx.fillText(formatTime(t), x + 3, height - 3)
      }
    }
  }, [waveformData, region, currentTime, duration, zoom, zoomOffset])

  // Update current time during playback
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateProgress = () => setCurrentTime(audio.currentTime)
    audio.addEventListener('timeupdate', updateProgress)
    audio.addEventListener('ended', () => setIsPlaying(false))
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration))

    return () => {
      audio.removeEventListener('timeupdate', updateProgress)
      audio.removeEventListener('ended', () => setIsPlaying(false))
      audio.removeEventListener('loadedmetadata', () => setDuration(audio.duration))
    }
  }, [audioUrl])

  const getMarkerInterval = (visibleDuration: number): number => {
    if (visibleDuration < 10) return 1
    if (visibleDuration < 30) return 5
    if (visibleDuration < 60) return 10
    if (visibleDuration < 300) return 30
    return 60
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 10)
    if (mins > 0) return `${mins}:${secs.toString().padStart(2, '0')}`
    return `${secs}.${ms}s`
  }

  const formatTimeFull = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
    setIsPlaying(!isPlaying)
  }, [isPlaying])

  const seekTo = useCallback((time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(time, duration))
    setCurrentTime(audio.currentTime)
  }, [duration])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || duration === 0) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = ((x / rect.width + zoomOffset) / zoom) * duration
    seekTo(time)
  }, [duration, zoom, zoomOffset, seekTo])

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !region || duration === 0) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = ((x / rect.width + zoomOffset) / zoom) * duration

    const startPixel = ((region.start / duration) - zoomOffset) * zoom * rect.width
    const endPixel = ((region.end / duration) - zoomOffset) * zoom * rect.width

    if (Math.abs(x - startPixel) < 10) {
      setIsDragging('start')
    } else if (Math.abs(x - endPixel) < 10) {
      setIsDragging('end')
    } else if (x > startPixel && x < endPixel) {
      setIsDragging('move')
    }
  }, [region, duration, zoom, zoomOffset])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !region || duration === 0) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = Math.max(0, Math.min(duration, ((x / rect.width + zoomOffset) / zoom) * duration))

    if (isDragging === 'start') {
      const newStart = Math.min(time, region.end - 0.1)
      const newRegion = { ...region, start: newStart }
      setRegion(newRegion)
      onRegionChange?.(newStart, region.end)
    } else if (isDragging === 'end') {
      const newEnd = Math.max(time, region.start + 0.1)
      const newRegion = { ...region, end: newEnd }
      setRegion(newRegion)
      onRegionChange?.(region.start, newEnd)
    } else if (isDragging === 'move') {
      const regionDuration = region.end - region.start
      let newStart = time - regionDuration / 2
      let newEnd = time + regionDuration / 2

      if (newStart < 0) {
        newStart = 0
        newEnd = regionDuration
      }
      if (newEnd > duration) {
        newEnd = duration
        newStart = duration - regionDuration
      }

      const newRegion = { start: newStart, end: newEnd }
      setRegion(newRegion)
      onRegionChange?.(newStart, newEnd)
    }
  }, [isDragging, region, duration, zoom, zoomOffset, onRegionChange])

  const handleCanvasMouseUp = useCallback(() => setIsDragging(null), [])

  const zoomIn = useCallback(() => setZoom(z => Math.min(10, z * 1.5)), [])
  const zoomOut = useCallback(() => setZoom(z => Math.max(1, z / 1.5)), [])

  const resetRegion = useCallback(() => {
    if (duration > 0) {
      const newRegion = { start: 0, end: duration }
      setRegion(newRegion)
      onRegionChange?.(0, duration)
    }
  }, [duration, onRegionChange])

  // Encode audio buffer to MP3
  const encodeToMP3 = useCallback((audioBuffer: AudioBuffer): Blob => {
    if (!lamejsModule) {
      throw new Error('MP3 кодировщик не загружен')
    }

    const mp3encoder = new lamejsModule.Mp3Encoder(1, audioBuffer.sampleRate, 128)
    const samples = audioBuffer.getChannelData(0)
    const sampleBlockSize = 1152
    const mp3Data: Int8Array[] = []

    const samples16 = new Int16Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      samples16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }

    for (let i = 0; i < samples16.length; i += sampleBlockSize) {
      const chunk = samples16.subarray(i, i + sampleBlockSize)
      const mp3buf = mp3encoder.encodeBuffer(chunk)
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf)
      }
    }

    const mp3buf = mp3encoder.flush()
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf)
    }

    const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of mp3Data) {
      result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), offset)
      offset += chunk.length
    }

    return new Blob([result], { type: 'audio/mp3' })
  }, [])

  const trimAudio = useCallback(async () => {
    if (!audioBufferRef.current || !region) {
      console.log('No audio buffer or region')
      return
    }

    setIsEncoding(true)
    setError(null)

    try {
      const audioBuffer = audioBufferRef.current
      const sampleRate = audioBuffer.sampleRate
      const startSample = Math.floor(region.start * sampleRate)
      const endSample = Math.floor(region.end * sampleRate)
      const numSamples = endSample - startSample

      // Create new buffer for trimmed audio (mono)
      const offlineContext = new OfflineAudioContext(1, numSamples, sampleRate)
      const newBuffer = offlineContext.createBuffer(1, numSamples, sampleRate)
      const destData = newBuffer.getChannelData(0)

      if (audioBuffer.numberOfChannels >= 2) {
        const leftChannel = audioBuffer.getChannelData(0)
        const rightChannel = audioBuffer.getChannelData(1)
        for (let i = 0; i < numSamples; i++) {
          destData[i] = (leftChannel[startSample + i] + rightChannel[startSample + i]) / 2
        }
      } else {
        const sourceData = audioBuffer.getChannelData(0)
        for (let i = 0; i < numSamples; i++) {
          destData[i] = sourceData[startSample + i]
        }
      }

      const mp3Blob = encodeToMP3(newBuffer)
      onTrimmedAudio?.(mp3Blob, region.start, region.end)
    } catch (err: any) {
      console.error('Error encoding MP3:', err)
      setError(err.message || 'Ошибка кодирования MP3')
    } finally {
      setIsEncoding(false)
    }
  }, [region, encodeToMP3, onTrimmedAudio])

  const toggleMute = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }, [isMuted])

  const skipBackward = useCallback(() => seekTo(currentTime - 5), [currentTime, seekTo])
  const skipForward = useCallback(() => seekTo(currentTime + 5), [currentTime, seekTo])

  if (!audioUrl) {
    return (
      <div className="flex items-center justify-center h-48 bg-slate-800/50 rounded-xl border border-slate-700">
        <p className="text-slate-500">Загрузите аудиофайл для редактирования</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-48 bg-slate-800/50 rounded-xl border border-slate-700 space-y-4">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
        <p className="text-white font-medium">Загрузка аудио...</p>
        <div className="w-48">
          <Progress value={loadProgress} className="h-2" />
        </div>
        <p className="text-slate-400 text-sm">{loadProgress}%</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-48 bg-slate-800/50 rounded-xl border border-red-500/50 space-y-4">
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-red-400 font-medium">{error}</p>
        <Button variant="outline" onClick={() => setError(null)}>
          Попробовать снова
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 relative">
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {isReady && (
        <div className="flex items-center justify-center gap-2 text-emerald-400 mb-2">
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm">Аудио готово к редактированию</span>
        </div>
      )}

      {/* Encoding overlay */}
      {isEncoding && (
        <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center z-20 rounded-xl">
          <Loader2 className="w-8 h-8 text-emerald-400 animate-spin mb-2" />
          <p className="text-white">Кодирование MP3...</p>
        </div>
      )}

      <div ref={containerRef} className="relative bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-32 cursor-crosshair"
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />

        {region && (
          <div className="absolute top-2 left-2 flex gap-2">
            <Badge variant="secondary" className="bg-white/90 text-slate-800 font-medium shadow-sm">
              {formatTimeFull(region.start)} - {formatTimeFull(region.end)}
            </Badge>
            <Badge variant="secondary" className="bg-emerald-500/90 text-white font-medium shadow-sm">
              {formatTimeFull(region.end - region.start)} выбрано
            </Badge>
          </div>
        )}
      </div>

      <div className="px-1">
        <Slider
          value={[currentTime]}
          min={0}
          max={duration || 100}
          step={0.1}
          onValueChange={([v]) => seekTo(v)}
          className="cursor-pointer"
        />
        <div className="flex justify-between text-xs text-slate-300 mt-1">
          <span>{formatTimeFull(currentTime)}</span>
          <span>{formatTimeFull(duration)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <div className="flex items-center gap-1 mr-4">
          <Button variant="outline" size="icon" onClick={zoomOut} disabled={zoom <= 1}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Badge variant="secondary" className="min-w-[3rem] justify-center">
            {zoom.toFixed(1)}x
          </Badge>
          <Button variant="outline" size="icon" onClick={zoomIn} disabled={zoom >= 10}>
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={skipBackward}>
            <SkipBack className="w-4 h-4" />
          </Button>
          <Button
            onClick={togglePlay}
            className="w-12 h-12 bg-emerald-500 hover:bg-emerald-600"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </Button>
          <Button variant="outline" size="icon" onClick={skipForward}>
            <SkipForward className="w-4 h-4" />
          </Button>
        </div>

        <Button variant="outline" size="icon" onClick={toggleMute} className="ml-2">
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </Button>

        <div className="flex items-center gap-1 ml-4">
          <Button variant="outline" size="sm" onClick={resetRegion}>
            <RotateCcw className="w-4 h-4 mr-1" />
            Сбросить
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={trimAudio}
            disabled={!region || isEncoding || !lamejsModule}
          >
            {isEncoding ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                Кодирование...
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4 mr-1" />
                Вырезать MP3
              </>
            )}
          </Button>
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        Перетащите края выделенной области для выбора участка • MP3 128kbps
      </p>
    </div>
  )
}
