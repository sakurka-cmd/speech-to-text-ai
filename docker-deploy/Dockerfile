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

# Create config directory and set permissions
RUN mkdir -p /app/config /app/data/uploads && \
    chown -R nextjs:nodejs /app/data /app/config

COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

USER nextjs

EXPOSE 3000 3003

ENV PORT=3000
ENV ASR_PORT=3003
ENV HOSTNAME="0.0.0.0"

CMD ["/app/docker-start.sh"]
