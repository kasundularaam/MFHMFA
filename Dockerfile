# Stage 1: Build frontend & server TypeScript
FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
COPY web ./web
COPY bin ./bin

RUN npm run build && npm prune --omit=dev

# Stage 2: Lean production runtime with Chromium + clean typography
FROM node:24-bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=48333 \
    CHROME_PATH=/usr/bin/chromium \
    MERMAID_STUDIO_DATA_DIR=/app/data

RUN mkdir -p /app/data/renders/previews && chown -R node:node /app

COPY --chown=node:node package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node bin ./bin

USER node

EXPOSE 48333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:48333/api/status').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/server.js"]
