# Whisper ASR Service Dockerfile
FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    git \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Upgrade pip and install setuptools first
RUN pip install --upgrade pip setuptools wheel

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

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

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Run
CMD ["python", "main.py"]
