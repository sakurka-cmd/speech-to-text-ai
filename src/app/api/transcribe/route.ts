import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null

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

    // Check file size (max 10MB for direct API, use WebSocket for larger files)
    const maxSize = 10 * 1024 * 1024
    if (audioFile.size > maxSize) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'File too large for direct API. Please use WebSocket endpoint for files larger than 10MB.',
          useWebSocket: true 
        },
        { status: 413 }
      )
    }

    // Convert to base64
    const arrayBuffer = await audioFile.arrayBuffer()
    const base64Audio = Buffer.from(arrayBuffer).toString('base64')

    // Initialize ZAI
    if (!zaiInstance) {
      zaiInstance = await ZAI.create()
    }

    // Transcribe
    const response = await zaiInstance.audio.asr.create({
      file_base64: base64Audio
    })

    return NextResponse.json({
      success: true,
      transcription: response.text,
      wordCount: response.text.split(/\s+/).filter(w => w.length > 0).length,
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
