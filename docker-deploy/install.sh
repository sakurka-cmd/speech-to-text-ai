#!/bin/bash
# Установка Speech to Text AI на сервер
# Запуск: sudo ./install.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DOCKER_BASE="/srv/docker"
APP_NAME="speech-to-text-ai"
COMPOSE_DIR="${DOCKER_BASE}/compose/${APP_NAME}"
DATA_DIR="${DOCKER_BASE}/data/${APP_NAME}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Speech to Text AI - Установка${NC}"
echo -e "${BLUE}========================================${NC}"

# Проверка прав
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Запустите скрипт с правами root или через sudo${NC}"
    exit 1
fi

# Проверка структуры Docker
echo -e "${YELLOW}Проверка структуры Docker...${NC}"
[ ! -d "${DOCKER_BASE}/compose" ] && { echo -e "${RED}Директория ${DOCKER_BASE}/compose не найдена!${NC}"; exit 1; }
[ ! -d "${DOCKER_BASE}/data" ] && { echo -e "${RED}Директория ${DOCKER_BASE}/data не найдена!${NC}"; exit 1; }
echo -e "${GREEN}✓ Структура Docker найдена${NC}"

# Создание директорий
echo -e "${YELLOW}Создание директорий...${NC}"
mkdir -p "${COMPOSE_DIR}" "${DATA_DIR}"/{data,logs,uploads}
echo -e "${GREEN}✓ Директории созданы${NC}"

# Клонирование
echo -e "${YELLOW}Клонирование репозитория...${NC}"
cd "${COMPOSE_DIR}"
if [ -d ".git" ]; then
    git pull
else
    git clone https://github.com/sakurka-cmd/speech-to-text-ai.git .
fi
echo -e "${GREEN}✓ Репозиторий готов${NC}"

# Проверка/создание конфига Z.ai
echo ""
ZAI_CONFIG="${DATA_DIR}/.z-ai-config"
if [ ! -f "${ZAI_CONFIG}" ]; then
    echo -e "${YELLOW}Создание конфигурационного файла Z.ai...${NC}"
    echo ""
    echo -e "${BLUE}Для работы приложения необходим API ключ Z.ai${NC}"
    echo -e "Получите ключ на: ${GREEN}https://z.ai${NC}"
    echo ""
    read -p "Введите baseUrl (например, https://api.z.ai/v1): " BASE_URL
    read -p "Введите apiKey: " API_KEY
    read -p "Введите chatId: " CHAT_ID
    read -p "Введите token: " TOKEN
    read -p "Введите userId: " USER_ID
    
    cat > "${ZAI_CONFIG}" << EOF
{
  "baseUrl": "${BASE_URL}",
  "apiKey": "${API_KEY}",
  "chatId": "${CHAT_ID}",
  "token": "${TOKEN}",
  "userId": "${USER_ID}"
}
EOF
    echo -e "${GREEN}✓ Конфигурационный файл создан: ${ZAI_CONFIG}${NC}"
else
    echo -e "${GREEN}✓ Конфигурационный файл уже существует: ${ZAI_CONFIG}${NC}"
fi

# Права
chown -R 1001:1001 "${DATA_DIR}"
chmod 600 "${ZAI_CONFIG}"

# Создание docker-start.sh
cat > "${COMPOSE_DIR}/docker-start.sh" << 'EOF'
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
EOF
chmod +x "${COMPOSE_DIR}/docker-start.sh"

# Создание docker-compose.yml
cat > "${COMPOSE_DIR}/docker-compose.yml" << 'EOF'
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
EOF

# Создание Dockerfile
cat > "${COMPOSE_DIR}/Dockerfile" << 'EOF'
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
EOF

echo -e "${GREEN}✓ Docker файлы созданы${NC}"

# Сборка и запуск
echo -e "${YELLOW}Сборка Docker образа...${NC}"
docker compose build

echo -e "${YELLOW}Запуск контейнера...${NC}"
docker compose up -d

sleep 5
docker compose ps

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Установка завершена!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "🌐 Web интерфейс:  http://<IP-сервера>:3010"
echo -e "🔌 WebSocket:      ws://<IP-сервера>:3013"
echo ""
echo -e "📁 Конфиг Z.ai:    ${ZAI_CONFIG}"
echo ""
echo -e "Управление:"
echo -e "  cd ${COMPOSE_DIR}"
echo -e "  docker compose up -d     # Запуск"
echo -e "  docker compose down      # Остановка"
echo -e "  docker compose logs -f   # Логи"
