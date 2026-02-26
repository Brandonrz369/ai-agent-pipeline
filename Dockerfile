# AI Agent Pipeline -- Dockerfile
# Multi-stage: builder (TypeScript compile) + production (minimal alpine)

# Stage 1: Builder -- install all deps and compile TypeScript
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Stage 2: Production -- minimal runtime image
FROM node:22-alpine AS production

# tini: proper PID 1 init and signal forwarding
RUN apk add --no-cache tini

WORKDIR /app

# Non-root user for security
RUN addgroup -S pipeline && adduser -S pipeline -G pipeline

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled JS from builder
COPY --from=builder /app/dist/ ./dist/

# Runtime assets
COPY schemas/ ./schemas/
COPY config/ ./config/

# Dead-letter queue data dir
RUN mkdir -p /home/pipeline/.openclaw && \
    chown -R pipeline:pipeline /home/pipeline/.openclaw

# Drop privileges
USER pipeline

# Webhook server port
EXPOSE 3847

# Container health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3847/health || exit 1

# tini as entrypoint ensures proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/cli.js", "serve"]
