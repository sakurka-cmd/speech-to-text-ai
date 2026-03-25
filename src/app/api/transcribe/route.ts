import { NextRequest, NextResponse } from 'next/server'

// Whisper service URL (internal Docker network)
const WHISPER_SERVICE_URL = process.env.WHISPER_SERVICE_URL || 'http://whisper:5000'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File

    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: 'No audio file provided' },
        { status: 400 }
      )
    }

    // Check file size (max 10MB for REST API, use WebSocket for larger files)
    const maxSize = 10 * 1024 * 1024
    if (audioFile.size > maxSize) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'File too large for direct API. Use WebSocket for files larger than 10MB.',
          useWebSocket: true 
        },
        { status: 413 }
      )
    }

    // Forward to Whisper service
    const whisperFormData = new FormData()
    whisperFormData.append('file', audioFile, audioFile.name)

    const response = await fetch(`${WHISPER_SERVICE_URL}/transcribe`, {
      method: 'POST',
      body: whisperFormData
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return NextResponse.json(
        { success: false, error: errorData.detail || 'Whisper service error' },
        { status: response.status }
      )
    }

    const result = await response.json()

    return NextResponse.json({
      success: true,
      transcription: result.text,
      language: result.language,
      wordCount: result.word_count,
      duration: result.duration,
      processingTime: result.processing_time,
      fileName: audioFile.name,
      fileSize: audioFile.size
    })
  } catch (error: any) {
    console.error('Transcription error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Transcription failed' },
      { status: 500 }
    )
  }
}
