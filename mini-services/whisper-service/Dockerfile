# Whisper ASR Service Dockerfile (CPU-only)
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip and install setuptools first
RUN pip install --upgrade pip setuptools wheel

# Install CPU-only PyTorch FIRST (avoid downloading CUDA)
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu

# Copy requirements and install rest
COPY requirements.txt .
RUN pip install --no-cache-dir openai-whisper fastapi uvicorn[standard] websockets python-multipart

# Copy application
COPY main.py .

# Create temp directory
RUN mkdir -p /tmp/whisper

# Environment
ENV PYTHONUNBUFFERED=1
ENV WHISPER_MODEL=small
ENV WHISPER_DEVICE=cpu
ENV PORT=5000
ENV TMPDIR=/tmp/whisper

EXPOSE 5000

# Health check using Python
HEALTHCHECK --interval=30s --timeout=15s --start-period=300s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/health')" || exit 1

# Run
CMD ["python", "main.py"]
