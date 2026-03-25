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
RUN bun install --frozen-lockfile
RUN cd mini-services/asr-service && bun install --frozen-lockfile

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

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy mini-services
COPY --from=builder /app/mini-services ./mini-services

# Install bun in runner
RUN npm install -g bun

# Copy node_modules for mini-services
COPY --from=builder /app/mini-services/asr-service/node_modules ./mini-services/asr-service/node_modules
COPY --from=builder /app/mini-services/asr-service/package.json ./mini-services/asr-service/
COPY --from=builder /app/mini-services/asr-service/index.ts ./mini-services/asr-service/

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
