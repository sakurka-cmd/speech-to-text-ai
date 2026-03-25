#!/bin/sh
set -e

echo "Starting Speech to Text AI application..."

# Start ASR WebSocket service in background
echo "Starting ASR WebSocket service on port 3003..."
cd /app/mini-services/asr-service
bun run index.ts &
ASR_PID=$!
cd /app

# Wait for ASR service to be ready
sleep 2

# Start Next.js server
echo "Starting Next.js server on port 3000..."
node server.js

# Handle shutdown
trap "kill $ASR_PID 2>/dev/null" EXIT
