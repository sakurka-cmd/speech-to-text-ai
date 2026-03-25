#!/usr/bin/env python3
"""
Whisper ASR Service
FastAPI сервис для распознавания речи с использованием OpenAI Whisper
"""

import os
import io
import json
import asyncio
import logging
import tempfile
from datetime import datetime
from typing import Optional
from pathlib import Path

import torch
import whisper
from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configuration
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE", 100 * 1024 * 1024))  # 100MB
PORT = int(os.getenv("PORT", 5000))

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("whisper-service")

# FastAPI app
app = FastAPI(
    title="Whisper ASR Service",
    description="Speech-to-text service using OpenAI Whisper",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global model
whisper_model = None


def load_model():
    """Load Whisper model"""
    global whisper_model
    if whisper_model is None:
        logger.info(f"Loading Whisper model: {WHISPER_MODEL} on device: {WHISPER_DEVICE}")
        whisper_model = whisper.load_model(WHISPER_MODEL, device=WHISPER_DEVICE)
        logger.info(f"Whisper model {WHISPER_MODEL} loaded successfully")
    return whisper_model


@app.on_event("startup")
async def startup_event():
    """Preload model on startup"""
    load_model()


class TranscriptionResult(BaseModel):
    """Transcription result model"""
    text: str
    language: str
    duration: float
    word_count: int
    processing_time: float


class ProgressTracker:
    """Track transcription progress for WebSocket"""
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.progress = 0
        self.status = "initializing"
    
    async def update(self, progress: int, status: str):
        """Send progress update"""
        self.progress = progress
        self.status = status
        try:
            await self.websocket.send_json({
                "type": "progress",
                "progress": progress,
                "status": status
            })
        except Exception as e:
            logger.error(f"Error sending progress: {e}")


def simulate_progress_task(progress_tracker: ProgressTracker, total_duration: float):
    """Simulate progress during transcription (Whisper doesn't provide real progress)"""
    import time
    import threading
    
    def progress_loop():
        estimated_time = total_duration * 0.5  # Rough estimate
        start_time = time.time()
        
        while progress_tracker.progress < 90:
            elapsed = time.time() - start_time
            if estimated_time > 0:
                progress = min(90, int((elapsed / estimated_time) * 90))
            else:
                progress = min(90, progress_tracker.progress + 5)
            
            # Update status based on progress
            if progress < 30:
                status = "Загрузка аудио..."
            elif progress < 60:
                status = "Анализ речи..."
            elif progress < 90:
                status = "Распознавание текста..."
            else:
                status = "Финальная обработка..."
            
            # Run async update in event loop
            asyncio.run_coroutine_threadsafe(
                progress_tracker.update(progress, status),
                asyncio.get_event_loop()
            )
            
            time.sleep(0.5)
    
    thread = threading.Thread(target=progress_loop, daemon=True)
    thread.start()
    return thread


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "Whisper ASR Service",
        "model": WHISPER_MODEL,
        "device": WHISPER_DEVICE
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy"}


@app.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_file(file: UploadFile = File(...)):
    """
    Transcribe audio file to text
    
    Supports: WAV, MP3, M4A, FLAC, OGG, WebM
    """
    start_time = datetime.now()
    
    # Check file size
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB"
        )
    
    # Validate file type
    allowed_types = ["audio/wav", "audio/mp3", "audio/mpeg", "audio/m4a",
                     "audio/x-m4a", "audio/flac", "audio/ogg", "audio/webm",
                     "video/webm"]
    
    # Also check extension
    file_ext = Path(file.filename).suffix.lower()
    allowed_extensions = [".wav", ".mp3", ".m4a", ".flac", ".ogg", ".webm"]
    
    if file.content_type not in allowed_types and file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type or file_ext}"
        )
    
    try:
        # Load model
        model = load_model()
        
        # Read file content
        content = await file.read()
        
        # Save to temp file (Whisper needs file path)
        with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp_file:
            tmp_file.write(content)
            tmp_path = tmp_file.name
        
        try:
            # Transcribe
            logger.info(f"Transcribing file: {file.filename} ({file_size} bytes)")
            
            result = model.transcribe(
                tmp_path,
                language=None,  # Auto-detect
                task="transcribe",
                fp16=False if WHISPER_DEVICE == "cpu" else True
            )
            
            text = result["text"].strip()
            language = result.get("language", "unknown")
            
            # Get audio duration
            try:
                import torchaudio
                waveform, sample_rate = torchaudio.load(tmp_path)
                duration = waveform.shape[1] / sample_rate
            except:
                duration = 0
            
            processing_time = (datetime.now() - start_time).total_seconds()
            word_count = len(text.split())
            
            logger.info(f"Transcription completed: {word_count} words in {processing_time:.2f}s")
            
            return TranscriptionResult(
                text=text,
                language=language,
                duration=duration,
                word_count=word_count,
                processing_time=processing_time
            )
            
        finally:
            # Cleanup temp file
            os.unlink(tmp_path)
            
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    """
    WebSocket endpoint for transcription with real-time progress
    """
    await websocket.accept()
    logger.info("WebSocket client connected")
    
    progress_tracker = ProgressTracker(websocket)
    
    try:
        while True:
            # Receive file data
            data = await websocket.receive()
            
            if data["type"] == "websocket.receive":
                # Check if it's JSON metadata or binary data
                if "text" in data:
                    # JSON metadata
                    try:
                        metadata = json.loads(data["text"])
                        if metadata.get("type") == "start":
                            await progress_tracker.update(5, "Инициализация...")
                            
                            # Send ready signal
                            await websocket.send_json({
                                "type": "ready",
                                "message": "Ready to receive audio data"
                            })
                    except json.JSONDecodeError:
                        pass
                        
                elif "bytes" in data:
                    # Binary audio data
                    await progress_tracker.update(10, "Получение файла...")
                    
                    audio_data = data["bytes"]
                    file_ext = metadata.get("extension", ".wav") if 'metadata' in locals() else ".wav"
                    
                    # Save to temp file
                    with tempfile.NamedTemporaryFile(delete=False, suffix=file_ext) as tmp_file:
                        tmp_file.write(audio_data)
                        tmp_path = tmp_file.name
                    
                    try:
                        # Start progress simulation
                        model = load_model()
                        await progress_tracker.update(20, "Загрузка модели...")
                        
                        # Transcribe
                        await progress_tracker.update(30, "Распознавание речи...")
                        
                        result = model.transcribe(
                            tmp_path,
                            language=None,
                            task="transcribe",
                            fp16=False if WHISPER_DEVICE == "cpu" else True
                        )
                        
                        text = result["text"].strip()
                        language = result.get("language", "unknown")
                        
                        await progress_tracker.update(100, "Завершено!")
                        
                        # Send result
                        await websocket.send_json({
                            "type": "completed",
                            "result": {
                                "text": text,
                                "language": language,
                                "word_count": len(text.split())
                            }
                        })
                        
                        logger.info(f"WebSocket transcription completed: {len(text.split())} words")
                        
                    finally:
                        os.unlink(tmp_path)
                        
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass


if __name__ == "__main__":
    import uvicorn
    
    logger.info(f"Starting Whisper ASR Service on port {PORT}")
    logger.info(f"Model: {WHISPER_MODEL}, Device: {WHISPER_DEVICE}")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        log_level="info"
    )
