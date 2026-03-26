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
  CheckCircle
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

        // Simulate progress for fetch
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
        const samples = 200 // Number of bars
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

        // Normalize
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

    // Clear
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, width, height)

    // Calculate visible range based on zoom
    const visibleSamples = Math.ceil(waveformData.length / zoom)
    const startSample = Math.floor(zoomOffset * (waveformData.length - visibleSamples))

    // Draw waveform
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

    // Draw region selection
    if (region && duration > 0) {
      const startX = ((region.start / duration) * width - zoomOffset * width) * zoom
      const endX = ((region.end / duration) * width - zoomOffset * width) * zoom
      const regionWidth = endX - startX

      // Selection highlight
      ctx.fillStyle = 'rgba(16, 185, 129, 0.3)'
      ctx.fillRect(startX, 0, regionWidth, height)

      // Region borders
      ctx.strokeStyle = '#10b981'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(startX, 0)
      ctx.lineTo(startX, height)
      ctx.moveTo(endX, 0)
      ctx.lineTo(endX, height)
      ctx.stroke()

      // Handles
      ctx.fillStyle = '#10b981'
      ctx.fillRect(startX - 4, 0, 8, height)
      ctx.fillRect(endX - 4, 0, 8, height)
    }

    // Draw playhead
    if (duration > 0) {
      const playheadX = ((currentTime / duration) * width - zoomOffset * width) * zoom
      ctx.strokeStyle = '#f43f5e'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, height)
      ctx.stroke()
    }

    // Draw time markers
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

    const updateProgress = () => {
      setCurrentTime(audio.currentTime)
    }

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

    // Check if clicking near region handles
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

  const handleCanvasMouseUp = () => {
    setIsDragging(null)
  }

  const zoomIn = () => setZoom(z => Math.min(10, z * 1.5))
  const zoomOut = () => setZoom(z => Math.max(1, z / 1.5))

  const resetRegion = () => {
    if (duration > 0) {
      const newRegion = { start: 0, end: duration }
      setRegion(newRegion)
      onRegionChange?.(0, duration)
    }
  }

  const trimAudio = async () => {
    if (!audioBufferRef.current || !region) return

    const audioBuffer = audioBufferRef.current
    const sampleRate = audioBuffer.sampleRate
    const startSample = Math.floor(region.start * sampleRate)
    const endSample = Math.floor(region.end * sampleRate)
    const numSamples = endSample - startSample
    const numChannels = audioBuffer.numberOfChannels

    // Create new buffer for trimmed audio
    const offlineContext = new OfflineAudioContext(numChannels, numSamples, sampleRate)
    const newBuffer = offlineContext.createBuffer(numChannels, numSamples, sampleRate)

    for (let channel = 0; channel < numChannels; channel++) {
      const sourceData = audioBuffer.getChannelData(channel)
      const destData = newBuffer.getChannelData(channel)
      for (let i = 0; i < numSamples; i++) {
        destData[i] = sourceData[startSample + i]
      }
    }

    // Convert to WAV blob
    const wavBlob = await bufferToWav(newBuffer)
    onTrimmedAudio?.(wavBlob, region.start, region.end)
  }

  const bufferToWav = (buffer: AudioBuffer): Promise<Blob> => {
    return new Promise((resolve) => {
      const numChannels = buffer.numberOfChannels
      const sampleRate = buffer.sampleRate
      const format = 1 // PCM
      const bitDepth = 16

      const bytesPerSample = bitDepth / 8
      const blockAlign = numChannels * bytesPerSample
      const numSamples = buffer.length
      const dataSize = numSamples * blockAlign
      const bufferLength = 44 + dataSize

      const arrayBuffer = new ArrayBuffer(bufferLength)
      const view = new DataView(arrayBuffer)

      // WAV header
      writeString(view, 0, 'RIFF')
      view.setUint32(4, bufferLength - 8, true)
      writeString(view, 8, 'WAVE')
      writeString(view, 12, 'fmt ')
      view.setUint32(16, 16, true)
      view.setUint16(20, format, true)
      view.setUint16(22, numChannels, true)
      view.setUint32(24, sampleRate, true)
      view.setUint32(28, sampleRate * blockAlign, true)
      view.setUint16(32, blockAlign, true)
      view.setUint16(34, bitDepth, true)
      writeString(view, 36, 'data')
      view.setUint32(40, dataSize, true)

      // Write samples
      const channels: Float32Array[] = []
      for (let i = 0; i < numChannels; i++) {
        channels.push(buffer.getChannelData(i))
      }

      let offset = 44
      for (let i = 0; i < numSamples; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
          const sample = Math.max(-1, Math.min(1, channels[channel][i]))
          const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
          view.setInt16(offset, intSample, true)
          offset += 2
        }
      }

      resolve(new Blob([arrayBuffer], { type: 'audio/wav' }))
    })
  }

  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i))
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

  // Loading state
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
      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Ready indicator */}
      {isReady && (
        <div className="flex items-center justify-center gap-2 text-emerald-400 mb-2">
          <CheckCircle className="w-4 h-4" />
          <span className="text-sm">Аудио готово к редактированию</span>
        </div>
      )}

      {/* Waveform Canvas */}
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

        {/* Region info overlay */}
        {region && (
          <div className="absolute top-2 left-2 flex gap-2">
            <Badge variant="secondary" className="bg-slate-900/80">
              {formatTimeFull(region.start)} - {formatTimeFull(region.end)}
            </Badge>
            <Badge variant="secondary" className="bg-slate-900/80">
              {formatTimeFull(region.end - region.start)} выбрано
            </Badge>
          </div>
        )}
      </div>

      {/* Timeline Slider */}
      <div className="px-1">
        <Slider
          value={[currentTime]}
          min={0}
          max={duration || 100}
          step={0.1}
          onValueChange={([v]) => seekTo(v)}
          className="cursor-pointer"
        />
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>{formatTimeFull(currentTime)}</span>
          <span>{formatTimeFull(duration)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {/* Zoom */}
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

        {/* Playback */}
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

        {/* Volume */}
        <Button variant="outline" size="icon" onClick={toggleMute} className="ml-2">
          {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </Button>

        {/* Region actions */}
        <div className="flex items-center gap-1 ml-4">
          <Button variant="outline" size="sm" onClick={resetRegion}>
            <RotateCcw className="w-4 h-4 mr-1" />
            Сбросить
          </Button>
          <Button variant="outline" size="sm" onClick={trimAudio} disabled={!region}>
            <Scissors className="w-4 h-4 mr-1" />
            Вырезать
          </Button>
        </div>
      </div>

      {/* Selection help */}
      <p className="text-center text-xs text-slate-500">
        Перетащите края выделенной области для выбора участка • Двойной клик для воспроизведения выбранного
      </p>
    </div>
  )
}
