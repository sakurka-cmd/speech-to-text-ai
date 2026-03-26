#!/bin/bash
# Установка Speech to Text AI с Whisper на сервер
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
echo -e "${BLUE}  Speech to Text AI + Whisper${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

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
echo ""
echo -e "${YELLOW}Создание директорий...${NC}"
mkdir -p "${COMPOSE_DIR}" "${DATA_DIR}"/{data,logs,uploads}
chown -R 1001:1001 "${DATA_DIR}"
echo -e "${GREEN}✓ Директории созданы${NC}"

# Клонирование
echo ""
echo -e "${YELLOW}Клонирование репозитория...${NC}"
cd "${COMPOSE_DIR}"
if [ -d ".git" ]; then
    git pull
else
    git clone https://github.com/sakurka-cmd/speech-to-text-ai.git .
fi
echo -e "${GREEN}✓ Репозиторий готов${NC}"

# Выбор модели Whisper
echo ""
echo -e "${YELLOW}Выбор модели Whisper...${NC}"
echo ""
echo "Доступные модели:"
echo "  tiny   - Самая быстрая, низкое качество (~39MB)"
echo "  base   - Быстрая, базовое качество (~74MB)"
echo "  small  - Хорошее качество (~244MB) [рекомендуется]"
echo "  medium - Высокое качество (~769MB)"
echo "  large  - Максимальное качество (~1.5GB, требует GPU)"
echo ""
read -p "Выберите модель [tiny/base/small/medium/large] (по умолчанию small): " WHISPER_MODEL
WHISPER_MODEL=${WHISPER_MODEL:-small}
echo -e "${GREEN}✓ Выбрана модель: ${WHISPER_MODEL}${NC}"

# Создание docker-compose.yml
echo ""
echo -e "${YELLOW}Создание Docker файлов...${NC}"

cat > "${COMPOSE_DIR}/docker-compose.yml" << EOF
services:
  # Next.js Web Application
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
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # Node.js WebSocket Proxy
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
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # Python Whisper ASR Service
  whisper:
    build:
      context: ./mini-services/whisper-service
      dockerfile: Dockerfile
    container_name: speech-to-text-whisper
    restart: unless-stopped
    ports:
      - "5010:5000"
    environment:
      - WHISPER_MODEL=${WHISPER_MODEL}
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
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

networks:
  speech-network:
    driver: bridge

volumes:
  whisper-models:
EOF

# Создание Dockerfile для Next.js
cat > "${COMPOSE_DIR}/Dockerfile" << 'EOF'
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
EOF

# Создание Dockerfile для ASR Proxy
# Копируем из docker-deploy директории в корень
cp "${COMPOSE_DIR}/docker-deploy/Dockerfile.asr-proxy" "${COMPOSE_DIR}/Dockerfile.asr-proxy" 2>/dev/null || {
    # Fallback если файл не найден - создаём с Node.js вместо bun
    cat > "${COMPOSE_DIR}/Dockerfile.asr-proxy" << 'DOCKERFILE'
FROM node:20-alpine
WORKDIR /app
COPY mini-services/asr-service/package.json ./
COPY mini-services/asr-service/tsconfig.json ./
RUN npm install
COPY mini-services/asr-service/index.ts ./
RUN npx tsc
ENV NODE_ENV=production
ENV PORT=3003
EXPOSE 3003
CMD ["node", "dist/index.js"]
DOCKERFILE
}

echo -e "${GREEN}✓ Docker файлы созданы${NC}"

# Сборка
echo ""
echo -e "${YELLOW}Сборка Docker образов...${NC}"
echo -e "${BLUE}Это может занять несколько минут (первый запуск загрузит модель Whisper)...${NC}"

docker compose build || {
    echo -e "${RED}Ошибка сборки!${NC}"
    exit 1
}

echo -e "${GREEN}✓ Docker образы собраны${NC}"

# Запуск
echo ""
echo -e "${YELLOW}Запуск контейнеров...${NC}"
docker compose up -d

echo ""
echo -e "${YELLOW}Ожидание запуска Whisper (модель загружается)...${NC}"
sleep 10

# Статус
docker compose ps

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Установка завершена!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "🌐 Web интерфейс:     http://<IP-сервера>:3010"
echo -e "🔌 WebSocket:         ws://<IP-сервера>:3013"
echo -e "🎤 Whisper API:       http://<IP-сервера>:5010"
echo ""
echo -e "📊 Модель Whisper:    ${WHISPER_MODEL}"
echo ""
echo -e "Управление:"
echo -e "  cd ${COMPOSE_DIR}"
echo -e "  docker compose up -d        # Запуск"
echo -e "  docker compose down         # Остановка"
echo -e "  docker compose logs -f      # Логи всех сервисов"
echo -e "  docker compose logs -f whisper  # Логи Whisper"
echo ""
echo -e "${YELLOW}Важно: При первом запуске модель Whisper загружается автоматически.${NC}"
echo -e "${YELLOW}Это может занять 1-2 минуты. Проверьте статус:${NC}"
echo -e "  docker compose logs -f whisper"
