#!/bin/bash
# Установка Speech to Text AI в структуру Docker на сервере
# Запуск: ./install.sh

set -e

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Конфигурация
DOCKER_BASE="/srv/docker"
APP_NAME="speech-to-text-ai"
COMPOSE_DIR="${DOCKER_BASE}/compose/${APP_NAME}"
DATA_DIR="${DOCKER_BASE}/data/${APP_NAME}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Speech to Text AI - Установка${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Проверка прав
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Запустите скрипт с правами root или через sudo${NC}"
    exit 1
fi

# Проверка структуры Docker
echo -e "${YELLOW}Проверка структуры Docker...${NC}"
if [ ! -d "${DOCKER_BASE}/compose" ]; then
    echo -e "${RED}Директория ${DOCKER_BASE}/compose не найдена!${NC}"
    exit 1
fi

if [ ! -d "${DOCKER_BASE}/data" ]; then
    echo -e "${RED}Директория ${DOCKER_BASE}/data не найдена!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Структура Docker найдена${NC}"

# Создание директорий
echo ""
echo -e "${YELLOW}Создание директорий...${NC}"
mkdir -p "${COMPOSE_DIR}"
mkdir -p "${DATA_DIR}/data"
mkdir -p "${DATA_DIR}/logs"
mkdir -p "${DATA_DIR}/uploads"
echo -e "${GREEN}✓ Директории созданы:${NC}"
echo -e "  ${COMPOSE_DIR}"
echo -e "  ${DATA_DIR}"

# Клонирование репозитория
echo ""
echo -e "${YELLOW}Клонирование репозитория...${NC}"
if [ -d "${COMPOSE_DIR}/.git" ]; then
    echo -e "${YELLOW}Репозиторий уже существует, обновляем...${NC}"
    cd "${COMPOSE_DIR}" && git pull
else
    cd "${COMPOSE_DIR}"
    git clone https://github.com/sakurka-cmd/speech-to-text-ai.git . || {
        echo -e "${RED}Ошибка клонирования репозитория!${NC}"
        exit 1
    }
fi
echo -e "${GREEN}✓ Репозиторий склонирован${NC}"

# Копирование Docker файлов
echo ""
echo -e "${YELLOW}Настройка Docker файлов...${NC}"

# Создаем docker-start.sh
cat > "${COMPOSE_DIR}/docker-start.sh" << 'DOCKERSTART'
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
DOCKERSTART

chmod +x "${COMPOSE_DIR}/docker-start.sh"

# Создаем docker-compose.yml
cat > "${COMPOSE_DIR}/docker-compose.yml" << 'DOCKERCOMPOSE'
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
DOCKERCOMPOSE

# Создаем Dockerfile
cat > "${COMPOSE_DIR}/Dockerfile" << 'DOCKERFILE'
# Multi-stage build for production
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install bun
RUN npm install -g bun

# Copy package files
COPY package.json bun.lock* ./
COPY mini-services/asr-service/package.json ./mini-services/asr-service/

# Install dependencies
RUN bun install --frozen-lockfile || bun install
RUN cd mini-services/asr-service && bun install --frozen-lockfile || bun install

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Install bun
RUN npm install -g bun

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/mini-services/asr-service/node_modules ./mini-services/asr-service/node_modules
COPY . .

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install bun and wget for healthcheck
RUN npm install -g bun
RUN apk add --no-cache wget

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy mini-services
COPY --from=builder /app/mini-services ./mini-services

# Create data directories
RUN mkdir -p /app/data/uploads && chown -R nextjs:nodejs /app/data

# Copy startup script
COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

USER nextjs

EXPOSE 3000 3003

ENV PORT=3000
ENV ASR_PORT=3003
ENV HOSTNAME="0.0.0.0"

CMD ["/app/docker-start.sh"]
DOCKERFILE

# Обновляем next.config для standalone
if [ -f "${COMPOSE_DIR}/next.config.ts" ]; then
    # Добавляем output: 'standalone' если его нет
    if ! grep -q "output:" "${COMPOSE_DIR}/next.config.ts"; then
        sed -i 's/const config: NextConfig = {/const config: NextConfig = {\n  output: '\''standalone'\'',/' "${COMPOSE_DIR}/next.config.ts"
        echo -e "${GREEN}✓ next.config.ts обновлен для standalone режима${NC}"
    fi
fi

echo -e "${GREEN}✓ Docker файлы созданы${NC}"

# Права на директории
echo ""
echo -e "${YELLOW}Настройка прав доступа...${NC}"
chown -R 1001:1001 "${DATA_DIR}"
chmod -R 755 "${DATA_DIR}"
echo -e "${GREEN}✓ Права настроены${NC}"

# Сборка Docker образа
echo ""
echo -e "${YELLOW}Сборка Docker образа...${NC}"
echo -e "${BLUE}Это может занять несколько минут...${NC}"
cd "${COMPOSE_DIR}"
docker compose build || {
    echo -e "${RED}Ошибка сборки Docker образа!${NC}"
    exit 1
}
echo -e "${GREEN}✓ Docker образ собран${NC}"

# Запуск контейнера
echo ""
echo -e "${YELLOW}Запуск контейнера...${NC}"
docker compose up -d || {
    echo -e "${RED}Ошибка запуска контейнера!${NC}"
    exit 1
}
echo -e "${GREEN}✓ Контейнер запущен${NC}"

# Проверка статуса
sleep 5
echo ""
echo -e "${YELLOW}Проверка статуса...${NC}"
docker compose ps

# Вывод информации
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Установка завершена!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Информация о приложении:${NC}"
echo -e "  📁 Директория приложения: ${COMPOSE_DIR}"
echo -e "  📁 Директория данных:     ${DATA_DIR}"
echo -e "  🌐 Web интерфейс:         http://<IP-сервера>:3010"
echo -e "  🔌 WebSocket:             ws://<IP-сервера>:3013"
echo ""
echo -e "${BLUE}Команды управления:${NC}"
echo -e "  cd ${COMPOSE_DIR}"
echo -e "  docker compose up -d       # Запуск"
echo -e "  docker compose down        # Остановка"
echo -e "  docker compose logs -f     # Логи"
echo -e "  docker compose restart     # Перезапуск"
echo ""
echo -e "${BLUE}Для обновления:${NC}"
echo -e "  cd ${COMPOSE_DIR}"
echo -e "  git pull"
echo -e "  docker compose build --no-cache"
echo -e "  docker compose up -d"
echo ""
