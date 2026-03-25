# Установка Speech to Text AI на сервер

## Структура после установки

```
/srv/docker/
├── compose/
│   ├── vk-ruobr-bot/          # (существующий проект)
│   └── speech-to-text-ai/     # ← НОВОЕ
│       ├── bot/
│       ├── mini-services/
│       │   └── asr-service/
│       ├── src/
│       ├── docker-compose.yml
│       ├── Dockerfile
│       ├── docker-start.sh
│       └── ...
└── data/
    ├── vk-ruobr-bot/          # (существующие данные)
    └── speech-to-text-ai/     # ← НОВОЕ
        ├── data/
        ├── logs/
        └── uploads/
```

## Способ 1: Автоматическая установка

```bash
# Скачайте скрипт установки
cd /tmp
wget https://raw.githubusercontent.com/sakurka-cmd/speech-to-text-ai/main/docker-deploy/install.sh
chmod +x install.sh
sudo ./install.sh
```

## Способ 2: Ручная установка

### Шаг 1: Создание директорий

```bash
sudo mkdir -p /srv/docker/compose/speech-to-text-ai
sudo mkdir -p /srv/docker/data/speech-to-text-ai/{data,logs,uploads}
sudo chown -R 1001:1001 /srv/docker/data/speech-to-text-ai
```

### Шаг 2: Клонирование репозитория

```bash
cd /srv/docker/compose/speech-to-text-ai
sudo git clone https://github.com/sakurka-cmd/speech-to-text-ai.git .
```

### Шаг 3: Создание Docker файлов

#### Dockerfile

```dockerfile
# Multi-stage build for production
FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN npm install -g bun

COPY package.json bun.lock* ./
COPY mini-services/asr-service/package.json ./mini-services/asr-service/

RUN bun install --frozen-lockfile || bun install
RUN cd mini-services/asr-service && bun install --frozen-lockfile || bun install

FROM base AS builder
WORKDIR /app
RUN npm install -g bun

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/mini-services/asr-service/node_modules ./mini-services/asr-service/node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
RUN npm install -g bun
RUN apk add --no-cache wget

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/mini-services ./mini-services

RUN mkdir -p /app/data/uploads && chown -R nextjs:nodejs /app/data

COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

USER nextjs

EXPOSE 3000 3003

ENV PORT=3000
ENV ASR_PORT=3003
ENV HOSTNAME="0.0.0.0"

CMD ["/app/docker-start.sh"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  speech-to-text:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: speech-to-text-ai
    restart: unless-stopped
    ports:
      - "3010:3000"   # Next.js web app
      - "3013:3003"   # WebSocket ASR service
    volumes:
      - ../data/speech-to-text-ai/data:/app/data
      - ../data/speech-to-text-ai/logs:/app/logs
    environment:
      - NODE_ENV=production
      - PORT=3000
      - ASR_PORT=3003
      - HOSTNAME=0.0.0.0
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - speech-to-text-network
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

networks:
  speech-to-text-network:
    driver: bridge
```

#### docker-start.sh

```bash
#!/bin/sh
set -e

echo "Starting Speech to Text AI application..."

# Start ASR WebSocket service
echo "Starting ASR WebSocket service on port 3003..."
cd /app/mini-services/asr-service
bun run index.ts &
ASR_PID=$!
cd /app

sleep 2

# Start Next.js server
echo "Starting Next.js server on port 3000..."
node server.js

trap "kill $ASR_PID 2>/dev/null" EXIT
```

### Шаг 4: Сборка и запуск

```bash
cd /srv/docker/compose/speech-to-text-ai

# Сделать скрипт запуска исполняемым
chmod +x docker-start.sh

# Собрать Docker образ
sudo docker compose build

# Запустить контейнер
sudo docker compose up -d
```

### Шаг 5: Проверка

```bash
# Статус контейнера
sudo docker compose ps

# Логи
sudo docker compose logs -f

# Проверка веб-интерфейса
curl http://localhost:3010
```

## Порты

| Порт | Назначение |
|------|------------|
| 3010 | Web интерфейс (Next.js) |
| 3013 | WebSocket для ASR сервиса |

## Управление

```bash
cd /srv/docker/compose/speech-to-text-ai

# Запуск
docker compose up -d

# Остановка
docker compose down

# Перезапуск
docker compose restart

# Логи
docker compose logs -f

# Статус
docker compose ps
```

## Обновление

```bash
cd /srv/docker/compose/speech-to-text-ai

# Получить обновления
git pull

# Пересобрать образ
docker compose build --no-cache

# Перезапустить
docker compose up -d
```

## Настройка обратного прокси (Nginx)

```nginx
# /etc/nginx/sites-available/speech-to-text.conf
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
        proxy_connect_timeout 75s;
    }

    # WebSocket для ASR сервиса
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

## Мониторинг

```bash
# Проверка здоровья контейнера
docker inspect --format='{{.State.Health.Status}}' speech-to-text-ai

# Использование ресурсов
docker stats speech-to-text-ai

# Логи в реальном времени
docker compose logs -f --tail=100
```

## Резервное копирование

```bash
# Бэкап данных
tar -czvf speech-to-text-backup-$(date +%Y%m%d).tar.gz /srv/docker/data/speech-to-text-ai/
```
