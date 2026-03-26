'use client'

import { useState, useRef, useEffect } from 'react'
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
  CheckCircle
} from 'lucide-react'

// @ts-ignore - lamejs doesn't have proper types
import lamejs from 'lamejs'

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

  const containerRef = useRef<HTMLDivElement>(null)

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
      audioBufferRef.current = null
      return
    }

    const loadAudio = async () => {
      setIsLoading(true)
      setLoadProgress(0)
      setIsReady(false)

      try {
        setLoadProgress(10)

        const response = await fetch(audioUrl)
        const contentLength = response.headers.get('content-length')
        const total = contentLength ? parseInt(contentLength, 10) : 0

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
        const normalized = waveform.map(v => v / max)

        setWaveformData(normalized)
        setDuration(audioBuffer.duration)
        setCurrentTime(0)
        setRegion({ start: 0, end: audioBuffer.duration })

        setLoadProgress(100)
        setIsReady(true)

      } catch (error) {
        console.error('Error loading audio:', error)
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
      const regionWidth = endX - startX

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

    ctx.fillStyle = '#64748b'
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

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
    setIsPlaying(!isPlaying)
  }

  const seekTo = (time: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(time, duration))
    setCurrentTime(audio.currentTime)
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || duration === 0) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const time = ((x / rect.width + zoomOffset) / zoom) * duration
    seekTo(time)
  }

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
  }

  const handleCanvasMouseUp = () => setIsDragging(null)

  const zoomIn = () => setZoom(z => Math.min(10, z * 1.5))
  const zoomOut = () => setZoom(z => Math.max(1, z / 1.5))

  const resetRegion = () => {
    if (duration > 0) {
      const newRegion = { start: 0, end: duration }
      setRegion(newRegion)
      onRegionChange?.(0, duration)
    }
  }

  // Encode audio buffer to MP3 using lamejs
  const encodeToMP3 = (audioBuffer: AudioBuffer): Blob => {
    const mp3encoder = new lamejs.Mp3Encoder(1, audioBuffer.sampleRate, 128) // mono, sample rate, kbps

    const samples = audioBuffer.getChannelData(0)
    const sampleBlockSize = 1152 // must be multiple of 576 for lamejs
    const mp3Data: Int8Array[] = []

    // Convert float samples to Int16
    const samples16 = new Int16Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      samples16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }

    // Encode in blocks
    for (let i = 0; i < samples16.length; i += sampleBlockSize) {
      const chunk = samples16.subarray(i, i + sampleBlockSize)
      const mp3buf = mp3encoder.encodeBuffer(chunk)
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf)
      }
    }

    // Finish encoding
    const mp3buf = mp3encoder.flush()
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf)
    }

    // Combine all MP3 data
    const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const chunk of mp3Data) {
      result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), offset)
      offset += chunk.length
    }

    return new Blob([result], { type: 'audio/mp3' })
  }

  const trimAudio = async () => {
    if (!audioBufferRef.current || !region) return

    setIsEncoding(true)

    try {
      const audioBuffer = audioBufferRef.current
      const sampleRate = audioBuffer.sampleRate
      const startSample = Math.floor(region.start * sampleRate)
      const endSample = Math.floor(region.end * sampleRate)
      const numSamples = endSample - startSample
      const numChannels = 1 // Force mono for MP3

      // Create new buffer for trimmed audio (mono)
      const offlineContext = new OfflineAudioContext(numChannels, numSamples, sampleRate)
      const newBuffer = offlineContext.createBuffer(numChannels, numSamples, sampleRate)

      // Copy audio data (mix to mono if stereo)
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

      // Encode to MP3
      const mp3Blob = encodeToMP3(newBuffer)
      onTrimmedAudio?.(mp3Blob, region.start, region.end)
    } catch (error) {
      console.error('Error encoding MP3:', error)
    } finally {
      setIsEncoding(false)
    }
  }

  const toggleMute = () => {
    const audio = audioRef.current
    if (audio) {
      audio.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  const skipBackward = () => seekTo(currentTime - 5)
  const skipForward = () => seekTo(currentTime + 5)

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

  return (
    <div className="space-y-4">
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {isReady && (
        <div className="flex items-center justify-center gap-2 text-emerald-400 mb-2">
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm">Аудио готово к редактированию</span>
        </div>
      )}

      {/* Encoding overlay */}
      {isEncoding && (
        <div className="absolute inset-0 bg-slate-900/80 flex flex-col items-center justify-center z-10 rounded-xl">
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
            variant="default"
            size="icon"
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
            disabled={!region || isEncoding}
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
