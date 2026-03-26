'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, ZoomIn, ZoomOut, Scissors } from 'lucide-react'

// Import lamejs dynamically to avoid SSR issues
// @ts-ignore
let lamejs: any = null

interface WaveformEditorProps {
  audioBuffer: AudioBuffer | null
  audioUrl: string | null
  onRegionSelect?: (start: number, end: number) => void
  onRegionEncoded?: (blob: Blob, start: number, end: number) => void
}

interface Region {
  start: number // in seconds
  end: number // in seconds
}

export default function WaveformEditor({
  audioBuffer,
  audioUrl,
  onRegionSelect,
  onRegionEncoded
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
  const [isEncoding, setIsEncoding] = useState(false)
  const [panOffset, setPanOffset] = useState(0)

  // Load lamejs dynamically
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('lamejs').then((module) => {
        lamejs = module.default || module
      }).catch(err => {
        console.error('Failed to load lamejs:', err)
      })
    }
  }, [])

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

  // Encode selected region to MP3
  const encodeRegionToMp3 = async (): Promise<Blob | null> => {
    if (!audioBuffer || !region) return null

    setIsEncoding(true)
    try {
      const startSample = Math.floor(region.start * audioBuffer.sampleRate)
      const endSample = Math.floor(region.end * audioBuffer.sampleRate)
      const length = endSample - startSample

      // Create a new buffer for the selected region
      const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        length,
        audioBuffer.sampleRate
      )

      const newBuffer = offlineContext.createBuffer(
        audioBuffer.numberOfChannels,
        length,
        audioBuffer.sampleRate
      )

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const sourceData = audioBuffer.getChannelData(channel)
        const destData = newBuffer.getChannelData(channel)
        for (let i = 0; i < length; i++) {
          destData[i] = sourceData[startSample + i]
        }
      }

      // Convert to MP3 using lamejs
      const mp3Blob = await encodeBufferToMp3(newBuffer)
      
      if (mp3Blob && onRegionEncoded) {
        onRegionEncoded(mp3Blob, region.start, region.end)
      }

      return mp3Blob
    } catch (error) {
      console.error('Error encoding MP3:', error)
      throw error
    } finally {
      setIsEncoding(false)
    }
  }

  // Encode AudioBuffer to MP3
  const encodeBufferToMp3 = async (buffer: AudioBuffer): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      try {
        if (!lamejs) {
          // Fallback to WAV if lamejs not loaded
          const wavBlob = encodeBufferToWav(buffer)
          resolve(wavBlob)
          return
        }

        const channels = buffer.numberOfChannels
        const sampleRate = buffer.sampleRate
        const kbps = 128

        // @ts-ignore
        const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps)
        const mp3Data: Int8Array[] = []

        const left = buffer.getChannelData(0)
        const right = channels > 1 ? buffer.getChannelData(1) : left

        // Convert float samples to Int16
        const leftInt = new Int16Array(left.length)
        const rightInt = new Int16Array(right.length)

        for (let i = 0; i < left.length; i++) {
          leftInt[i] = Math.max(-32768, Math.min(32767, Math.floor(left[i] * 32767)))
          rightInt[i] = Math.max(-32768, Math.min(32767, Math.floor(right[i] * 32767)))
        }

        // Encode in chunks
        const blockSize = 1152
        for (let i = 0; i < leftInt.length; i += blockSize) {
          const leftChunk = leftInt.subarray(i, i + blockSize)
          const rightChunk = rightInt.subarray(i, i + blockSize)
          let mp3buf: Int8Array

          if (channels > 1) {
            mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk)
          } else {
            mp3buf = mp3encoder.encodeBuffer(leftChunk)
          }

          if (mp3buf.length > 0) {
            mp3Data.push(mp3buf)
          }
        }

        // Flush remaining
        const remaining = mp3encoder.flush()
        if (remaining.length > 0) {
          mp3Data.push(remaining)
        }

        // Combine all MP3 data
        const totalLength = mp3Data.reduce((acc, arr) => acc + arr.length, 0)
        const mp3Combined = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of mp3Data) {
          mp3Combined.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length), offset)
          offset += chunk.length
        }

        resolve(new Blob([mp3Combined], { type: 'audio/mp3' }))
      } catch (err) {
        console.error('MP3 encoding failed, falling back to WAV:', err)
        // Fallback to WAV
        const wavBlob = encodeBufferToWav(buffer)
        resolve(wavBlob)
      }
    })
  }

  // Fallback: Encode to WAV
  const encodeBufferToWav = (buffer: AudioBuffer): Blob => {
    const numChannels = buffer.numberOfChannels
    const sampleRate = buffer.sampleRate
    const format = 1 // PCM
    const bitDepth = 16

    const bytesPerSample = bitDepth / 8
    const blockAlign = numChannels * bytesPerSample
    const byteRate = sampleRate * blockAlign
    const dataSize = buffer.length * blockAlign
    const headerSize = 44
    const totalSize = headerSize + dataSize

    const arrayBuffer = new ArrayBuffer(totalSize)
    const view = new DataView(arrayBuffer)

    // RIFF header
    writeString(view, 0, 'RIFF')
    view.setUint32(4, totalSize - 8, true)
    writeString(view, 8, 'WAVE')

    // fmt chunk
    writeString(view, 12, 'fmt ')
    view.setUint32(16, 16, true) // chunk size
    view.setUint16(20, format, true)
    view.setUint16(22, numChannels, true)
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, byteRate, true)
    view.setUint16(32, blockAlign, true)
    view.setUint16(34, bitDepth, true)

    // data chunk
    writeString(view, 36, 'data')
    view.setUint32(40, dataSize, true)

    // Write samples
    const channels = []
    for (let i = 0; i < numChannels; i++) {
      channels.push(buffer.getChannelData(i))
    }

    let offset = 44
    for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, channels[channel][i]))
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
        view.setInt16(offset, intSample, true)
        offset += 2
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' })
  }

  const writeString = (view: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  // Download MP3
  const handleDownloadMp3 = async () => {
    const blob = await encodeRegionToMp3()
    if (!blob) return

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ext = blob.type === 'audio/mp3' ? 'mp3' : 'wav'
    a.download = `audio_selection_${formatTime(region?.start || 0)}-${formatTime(region?.end || 0)}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Expose encode function
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__encodeRegionToMp3 = encodeRegionToMp3
    }
  }, [audioBuffer, region])

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

      {/* Region info and actions */}
      {region && region.end - region.start > 0.1 && (
        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-700/50 rounded-lg p-3">
          <div className="text-sm">
            <span className="text-slate-400">Выбрано: </span>
            <span className="text-blue-400 font-mono">
              {formatTime(region.start)} - {formatTime(region.end)}
            </span>
            <span className="text-slate-500 ml-2">
              ({((region.end - region.start) / 60).toFixed(2)} мин)
            </span>
          </div>
          <Button
            onClick={handleDownloadMp3}
            disabled={isEncoding}
            className="bg-blue-500 hover:bg-blue-600"
          >
            <Scissors className="h-4 w-4 mr-2" />
            {isEncoding ? 'Кодирование...' : 'Вырезать MP3'}
          </Button>
        </div>
      )}

      {/* Instructions */}
      <div className="text-xs text-slate-500 text-center">
        Кликните и перетащите на волновой форме для выбора фрагмента
      </div>
    </div>
  )
}
