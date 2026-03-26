'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, ZoomIn, ZoomOut } from 'lucide-react'

interface WaveformEditorProps {
  audioBuffer: AudioBuffer | null
  audioUrl: string | null
  onRegionSelect?: (start: number, end: number) => void
}

interface Region {
  start: number // in seconds
  end: number // in seconds
}

export default function WaveformEditor({
  audioBuffer,
  audioUrl,
  onRegionSelect,
}: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [region, setRegion] = useState<Region | null>(null)
  const [isDragging, setIsDragging] = useState<'start' | 'end' | 'move' | null>(null)
  const [waveformData, setWaveformData] = useState<number[]>([])
  const [panOffset, setPanOffset] = useState(0)

  // Generate waveform data
  useEffect(() => {
    if (!audioBuffer) return

    const channelData = audioBuffer.getChannelData(0)
    const samples = 500 // Number of bars
    const blockSize = Math.floor(channelData.length / samples)
    const data: number[] = []

    for (let i = 0; i < samples; i++) {
      const start = blockSize * i
      let sum = 0
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(channelData[start + j] || 0)
      }
      data.push(sum / blockSize)
    }

    // Normalize
    const max = Math.max(...data)
    const normalized = data.map(d => d / max)
    setWaveformData(normalized)
  }, [audioBuffer])

  // Draw waveform
  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || waveformData.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr * zoom
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const width = rect.width * zoom
    const height = rect.height

    // Background
    ctx.fillStyle = '#1e293b'
    ctx.fillRect(0, 0, width, height)

    // Draw waveform bars
    const barWidth = width / waveformData.length
    const centerY = height / 2

    ctx.fillStyle = '#10b981'

    waveformData.forEach((value, i) => {
      const x = i * barWidth
      const barHeight = value * (height * 0.8)
      
      // Draw from center
      ctx.fillRect(x, centerY - barHeight / 2, barWidth - 1, barHeight)
    })

    // Draw region selection
    if (region && duration > 0) {
      const startX = (region.start / duration) * width - panOffset
      const endX = (region.end / duration) * width - panOffset
      const regionWidth = endX - startX

      // Region background
      ctx.fillStyle = 'rgba(59, 130, 246, 0.3)'
      ctx.fillRect(startX, 0, regionWidth, height)

      // Region borders
      ctx.strokeStyle = '#3b82f6'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(startX, 0)
      ctx.lineTo(startX, height)
      ctx.moveTo(endX, 0)
      ctx.lineTo(endX, height)
      ctx.stroke()

      // Handles
      ctx.fillStyle = '#3b82f6'
      ctx.fillRect(startX - 4, 0, 8, height)
      ctx.fillRect(endX - 4, 0, 8, height)
    }

    // Draw playhead
    if (duration > 0) {
      const playheadX = (currentTime / duration) * width * zoom - panOffset
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, height)
      ctx.stroke()
    }
  }, [waveformData, region, currentTime, duration, zoom, panOffset])

  useEffect(() => {
    drawWaveform()
  }, [drawWaveform])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => drawWaveform()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [drawWaveform])

  // Audio element events
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleLoadedMetadata = () => setDuration(audio.duration)
    const handleEnded = () => setIsPlaying(false)
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
    }
  }, [audioUrl])

  // Playback controls
  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
    } else {
      audio.play()
    }
  }

  const skipBack = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, audio.currentTime - 10)
  }

  const skipForward = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.min(duration, audio.currentTime + 10)
  }

  const toggleMute = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.muted = !isMuted
    setIsMuted(!isMuted)
  }

  const handleVolumeChange = (value: number[]) => {
    const audio = audioRef.current
    if (!audio) return
    const newVolume = value[0]
    audio.volume = newVolume
    setVolume(newVolume)
    setIsMuted(newVolume === 0)
  }

  const handleSeek = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const audio = audioRef.current
    if (!canvas || !audio || duration === 0) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left + panOffset
    const newTime = (x / (rect.width * zoom)) * duration
    audio.currentTime = Math.max(0, Math.min(duration, newTime))
  }

  // Region selection
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || duration === 0) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left + panOffset
    const time = (x / (rect.width * zoom)) * duration

    // Check if clicking on region handles
    if (region) {
      const startX = (region.start / duration) * rect.width * zoom - panOffset
      const endX = (region.end / duration) * rect.width * zoom - panOffset

      if (Math.abs(x - startX - panOffset) < 10) {
        setIsDragging('start')
        return
      }
      if (Math.abs(x - endX - panOffset) < 10) {
        setIsDragging('end')
        return
      }
      if (x > startX + panOffset && x < endX + panOffset) {
        setIsDragging('move')
        return
      }
    }

    // Start new selection
    setRegion({ start: time, end: time })
    setIsDragging('end')
  }

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !region) return

    const canvas = canvasRef.current
    if (!canvas || duration === 0) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left + panOffset
    let time = (x / (rect.width * zoom)) * duration
    time = Math.max(0, Math.min(duration, time))

    if (isDragging === 'start') {
      setRegion({ ...region, start: Math.min(time, region.end - 0.1) })
    } else if (isDragging === 'end') {
      setRegion({ ...region, end: Math.max(time, region.start + 0.1) })
    } else if (isDragging === 'move') {
      const width = region.end - region.start
      let newStart = time - width / 2
      newStart = Math.max(0, Math.min(duration - width, newStart))
      setRegion({ start: newStart, end: newStart + width })
    }

    onRegionSelect?.(region.start, region.end)
  }

  const handleCanvasMouseUp = () => {
    setIsDragging(null)
    if (region && onRegionSelect) {
      onRegionSelect(region.start, region.end)
    }
  }

  // Zoom controls
  const handleZoomIn = () => setZoom(Math.min(10, zoom + 1))
  const handleZoomOut = () => setZoom(Math.max(1, zoom - 1))

  // Format time
  const formatTime = (time: number): string => {
    const mins = Math.floor(time / 60)
    const secs = Math.floor(time % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!audioUrl || !audioBuffer) {
    return null
  }

  return (
    <div ref={containerRef} className="bg-slate-800 rounded-lg p-4 space-y-4">
      {/* Hidden audio element */}
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      {/* Waveform canvas */}
      <div className="relative overflow-hidden rounded-lg border border-slate-600">
        <canvas
          ref={canvasRef}
          className="w-full h-32 cursor-crosshair"
          onClick={handleSeek}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        />
      </div>

      {/* Timeline */}
      <div className="flex justify-between text-xs text-slate-400 px-2">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Playback buttons */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={skipBack} className="h-8 w-8">
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            onClick={togglePlay}
            className="h-10 w-10 rounded-full bg-emerald-500 hover:bg-emerald-600"
          >
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
          </Button>
          <Button variant="outline" size="icon" onClick={skipForward} className="h-8 w-8">
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Volume */}
        <div className="flex items-center gap-2 flex-1 max-w-32">
          <Button variant="ghost" size="icon" onClick={toggleMute} className="h-8 w-8">
            {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>
          <Slider
            value={[isMuted ? 0 : volume]}
            max={1}
            step={0.1}
            onValueChange={handleVolumeChange}
            className="flex-1"
          />
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={handleZoomOut} className="h-8 w-8">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-sm text-slate-400 w-12 text-center">{zoom}x</span>
          <Button variant="outline" size="icon" onClick={handleZoomIn} className="h-8 w-8">
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Instructions */}
      <div className="text-xs text-slate-500 text-center">
        Кликните и перетащите на волновой форме для выбора фрагмента
      </div>
    </div>
  )
}
