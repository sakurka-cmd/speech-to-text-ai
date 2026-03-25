# Speech to Text AI с OpenAI Whisper

## 🎯 Особенности

- **Без токенов** - Использует локальную модель OpenAI Whisper
- **Высокое качество** - Модели small/medium/large для точного распознавания
- **Автономность** - Работает без интернета после установки
- **Многим языки** - Автоопределение языка (включая русский)

## 📦 Архитектура

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Next.js Web   │────▶│   ASR Proxy     │────▶│   Whisper       │
│   (порт 3010)   │     │   (порт 3013)   │     │   (порт 5010)   │
│   UI + Upload   │     │   WebSocket     │     │   Python/FastAPI│
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 📁 Структура после установки

```
/srv/docker/
├── compose/
│   └── speech-to-text-ai/
│       ├── docker-compose.yml
│       ├── Dockerfile
│       ├── Dockerfile.asr-proxy
│       ├── mini-services/
│       │   ├── asr-service/       # Node.js WebSocket
│       │   └── whisper-service/   # Python Whisper
│       └── src/                   # Next.js app
└── data/
    └── speech-to-text-ai/
        ├── data/
        └── logs/
```

## 🚀 Быстрая установка

```bash
cd /tmp
wget https://raw.githubusercontent.com/sakurka-cmd/speech-to-text-ai/main/docker-deploy/install.sh
chmod +x install.sh
sudo ./install.sh
```

Скрипт попросит выбрать модель Whisper:
- **tiny** - Самая быстрая, низкое качество (~39MB)
- **base** - Быстрая, базовое качество (~74MB)
- **small** - Хорошее качество (~244MB) ⭐ рекомендуется
- **medium** - Высокое качество (~769MB)
- **large** - Максимальное качество (~1.5GB, требует GPU)

## 🔧 Ручная установка

### 1. Создание директорий

```bash
sudo mkdir -p /srv/docker/compose/speech-to-text-ai
sudo mkdir -p /srv/docker/data/speech-to-text-ai/{data,logs}
```

### 2. Клонирование

```bash
cd /srv/docker/compose/speech-to-text-ai
sudo git clone https://github.com/sakurka-cmd/speech-to-text-ai.git .
```

### 3. Создание docker-compose.yml

```yaml
services:
  web:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: speech-to-text-web
    restart: unless-stopped
    ports:
      - "3010:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - WHISPER_SERVICE_URL=http://whisper:5000
    depends_on:
      whisper:
        condition: service_healthy
    networks:
      - speech-network

  asr-proxy:
    build:
      context: .
      dockerfile: Dockerfile.asr-proxy
    container_name: speech-to-text-asr
    restart: unless-stopped
    ports:
      - "3013:3003"
    environment:
      - NODE_ENV=production
      - PORT=3003
      - WHISPER_SERVICE_URL=http://whisper:5000
    depends_on:
      whisper:
        condition: service_healthy
    networks:
      - speech-network

  whisper:
    build:
      context: ./mini-services/whisper-service
      dockerfile: Dockerfile
    container_name: speech-to-text-whisper
    restart: unless-stopped
    ports:
      - "5010:5000"
    environment:
      - WHISPER_MODEL=small
      - WHISPER_DEVICE=cpu
      - PORT=5000
    volumes:
      - whisper-models:/root/.cache/whisper
    networks:
      - speech-network
    deploy:
      resources:
        reservations:
          memory: 2G
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 120s

networks:
  speech-network:
    driver: bridge

volumes:
  whisper-models:
```

### 4. Создание Dockerfile (Next.js)

```dockerfile
FROM node:20-alpine AS base
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

FROM base AS builder
WORKDIR /app
RUN npm install -g bun
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN apk add --no-cache wget
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

### 5. Создание Dockerfile.asr-proxy

```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN npm install -g bun
COPY mini-services/asr-service/package.json ./
RUN bun install
COPY mini-services/asr-service/index.ts ./
ENV NODE_ENV=production
ENV PORT=3003
EXPOSE 3003
CMD ["bun", "run", "index.ts"]
```

### 6. Сборка и запуск

```bash
cd /srv/docker/compose/speech-to-text-ai
sudo docker compose build
sudo docker compose up -d
```

## 📊 Порты

| Сервис | Порт | Описание |
|--------|------|----------|
| Web UI | 3010 | Next.js веб-интерфейс |
| WebSocket | 3013 | ASR прокси для прогресса |
| Whisper API | 5010 | Python Whisper сервис |

## ⚙️ Управление

```bash
cd /srv/docker/compose/speech-to-text-ai

# Запуск
docker compose up -d

# Остановка
docker compose down

# Логи всех сервисов
docker compose logs -f

# Логи конкретного сервиса
docker compose logs -f whisper
docker compose logs -f web
docker compose logs -f asr-proxy

# Статус
docker compose ps

# Перезапуск
docker compose restart
```

## 🔄 Смена модели Whisper

Отредактируйте `docker-compose.yml`:

```yaml
whisper:
  environment:
    - WHISPER_MODEL=medium  # tiny/base/small/medium/large
```

Затем пересоберите:

```bash
docker compose down
docker compose build --no-cache whisper
docker compose up -d
```

## 🖥️ Требования

| Модель | RAM | CPU | Диск |
|--------|-----|-----|------|
| tiny | 1GB | 1 core | 100MB |
| base | 1GB | 1 core | 150MB |
| small | 2GB | 2 cores | 500MB |
| medium | 4GB | 4 cores | 1.5GB |
| large | 8GB+ | GPU | 3GB |

## 🌐 Nginx (опционально)

```nginx
server {
    listen 80;
    server_name speech.yourdomain.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:3013/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 300s;
    }
}
```

## 🔍 API Endpoints

### REST API (Whisper)

```bash
# Транскрипция файла
curl -X POST -F "file=@audio.mp3" http://localhost:5010/transcribe

# Ответ
{
  "text": "Распознанный текст",
  "language": "ru",
  "duration": 15.4,
  "word_count": 25,
  "processing_time": 3.2
}
```

### WebSocket (ASR Proxy)

```javascript
const socket = io('ws://localhost:3013');

socket.emit('start-transcription', {
  fileName: 'audio.mp3',
  fileSize: 1024000,
  base64Audio: '...'
});

socket.on('progress', (data) => {
  console.log(`Progress: ${data.progress}%`);
});

socket.on('completed', (data) => {
  console.log('Transcription:', data.transcription);
});
```

## ❓ Устранение проблем

### Whisper не запускается

```bash
# Проверьте логи
docker compose logs whisper

# Проверьте память
docker stats speech-to-text-whisper

# Увеличьте память в docker-compose.yml
deploy:
  resources:
    reservations:
      memory: 4G
```

### Медленная обработка

1. Используйте модель меньшего размера (tiny/base)
2. Увеличьте ресурсы контейнера
3. Для GPU установите `WHISPER_DEVICE=cuda`

### Ошибка "Out of memory"

```bash
# Уменьшите модель
WHISPER_MODEL=tiny

# Или добавьте swap
```

## 📝 Обновление

```bash
cd /srv/docker/compose/speech-to-text-ai
git pull
docker compose build --no-cache
docker compose up -d
```
