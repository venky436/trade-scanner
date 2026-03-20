FROM node:20-slim AS base

# --- Build stage ---
FROM base AS builder
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/

# Install all dependencies (including devDeps for tsc)
RUN npm ci --workspace=apps/server --include-workspace-root

# Copy server source
COPY apps/server ./apps/server

# Build TypeScript
RUN npm run build -w apps/server

# --- Production stage ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy root package files
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/

# Install production dependencies only
RUN npm ci --workspace=apps/server --include-workspace-root --omit=dev

# Copy compiled output
COPY --from=builder /app/apps/server/dist ./apps/server/dist

# Session file volume (persists kite token across restarts)
VOLUME /app/apps/server

WORKDIR /app/apps/server

EXPOSE 4000

CMD ["node", "dist/index.js"]
