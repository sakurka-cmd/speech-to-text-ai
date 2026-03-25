# Установка Speech to Text AI на сервер

## ⚠️ Важно: Конфигурация Z.ai SDK

Для работы приложения требуется конфигурационный файл `.z-ai-config` с API ключами Z.ai.

### Создание конфигурационного файла

Создайте файл `/srv/docker/data/speech-to-text-ai/.z-ai-config`:

```bash
sudo nano /srv/docker/data/speech-to-text-ai/.z-ai-config
```

Содержимое файла:
```json
{
  "baseUrl": "https://api.z.ai/v1",
  "apiKey": "YOUR_API_KEY",
  "chatId": "YOUR_CHAT_ID",
  "token": "YOUR_TOKEN",
  "userId": "YOUR_USER_ID"
}
```

**Получить ключи можно на:** https://z.ai

Установите права:
```bash
sudo chown 1001:1001 /srv/docker/data/speech-to-text-ai/.z-ai-config
sudo chmod 600 /srv/docker/data/speech-to-text-ai/.z-ai-config
```

---

## Структура после установки

```
/srv/docker/
├── compose/
│   ├── vk-ruobr-bot/          # (существующий проект)
│   └── speech-to-text-ai/     # ← НОВОЕ
│       ├── docker-compose.yml
│       ├── Dockerfile
│       ├── docker-start.sh
│       ├── src/
│       ├── mini-services/
│       └── ...
└── data/
    ├── vk-ruobr-bot/          # (существующие данные)
    └── speech-to-text-ai/     # ← НОВОЕ
        ├── .z-ai-config       # ← Конфиг Z.ai SDK
        ├── data/
        ├── logs/
        └── uploads/
```

---

## Быстрая установка (автоматическая)

```bash
cd /tmp
wget https://raw.githubusercontent.com/sakurka-cmd/speech-to-text-ai/main/docker-deploy/install.sh
chmod +x install.sh
sudo ./install.sh
```

Скрипт запросит данные для конфигурации Z.ai.

---

## Ручная установка

### Шаг 1: Создание директорий

```bash
sudo mkdir -p /srv/docker/compose/speech-to-text-ai
sudo mkdir -p /srv/docker/data/speech-to-text-ai/{data,logs,uploads}
```

### Шаг 2: Клонирование репозитория

```bash
cd /srv/docker/compose/speech-to-text-ai
sudo git clone https://github.com/sakurka-cmd/speech-to-text-ai.git .
```

### Шаг 3: Создание конфига Z.ai

```bash
sudo nano /srv/docker/data/speech-to-text-ai/.z-ai-config
```

Вставьте:
```json
{
  "baseUrl": "https://api.z.ai/v1",
  "apiKey": "YOUR_API_KEY",
  "chatId": "YOUR_CHAT_ID",
  "token": "YOUR_TOKEN",
  "userId": "YOUR_USER_ID"
}
```

Установите права:
```bash
sudo chown 1001:1001 /srv/docker/data/speech-to-text-ai/.z-ai-config
sudo chmod 600 /srv/docker/data/speech-to-text-ai/.z-ai-config
sudo chown -R 1001:1001 /srv/docker/data/speech-to-text-ai
```

### Шаг 4: Создание Docker файлов

**docker-compose.yml:**
```yaml
services:
  speech-to-text:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: speech-to-text-ai
    restart: unless-stopped
    ports:
      - "3010:3000"
      - "3013:3003"
    volumes:
      - ../data/speech-to-text-ai/data:/app/data
      - ../data/speech-to-text-ai/logs:/app/logs
      - ../data/speech-to-text-ai/.z-ai-config:/app/.z-ai-config:ro
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

**docker-start.sh:**
```bash
#!/bin/sh
set -e
echo "Starting Speech to Text AI..."
cd /app/mini-services/asr-service
bun run index.ts &
ASR_PID=$!
cd /app
sleep 2
node server.js
trap "kill $ASR_PID 2>/dev/null" EXIT
```

**Dockerfile:**
```dockerfile
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
RUN mkdir -p /app/config /app/data/uploads && chown -R nextjs:nodejs /app/data /app/config
COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh
USER nextjs
EXPOSE 3000 3003
ENV PORT=3000
ENV ASR_PORT=3003
ENV HOSTNAME="0.0.0.0"
CMD ["/app/docker-start.sh"]
```

### Шаг 5: Сборка и запуск

```bash
cd /srv/docker/compose/speech-to-text-ai
chmod +x docker-start.sh
sudo docker compose build
sudo docker compose up -d
```

### Шаг 6: Проверка

```bash
# Статус
sudo docker compose ps

# Логи
sudo docker compose logs -f

# Тест
curl http://localhost:3010
```

---

## Порты

| Порт | Назначение |
|------|------------|
| 3010 | Web интерфейс (Next.js) |
| 3013 | WebSocket для ASR сервиса |

---

## Управление

```bash
cd /srv/docker/compose/speech-to-text-ai

docker compose up -d        # Запуск
docker compose down         # Остановка
docker compose restart      # Перезапуск
docker compose logs -f      # Логи
docker compose ps           # Статус
```

---

## Обновление

```bash
cd /srv/docker/compose/speech-to-text-ai
git pull
docker compose build --no-cache
docker compose up -d
```

---

## Nginx (опционально)

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
}
```

---

## Устранение проблем

### Ошибка: "Configuration file not found"

Проверьте наличие конфига:
```bash
ls -la /srv/docker/data/speech-to-text-ai/.z-ai-config
```

Проверьте права:
```bash
sudo chown 1001:1001 /srv/docker/data/speech-to-text-ai/.z-ai-config
sudo chmod 600 /srv/docker/data/speech-to-text-ai/.z-ai-config
```

### Ошибка: "Connection refused"

Проверьте, что контейнер запущен:
```bash
docker compose ps
docker compose logs -f
```

### Перезапуск с новым конфигом

```bash
cd /srv/docker/compose/speech-to-text-ai
docker compose down
docker compose up -d
```
