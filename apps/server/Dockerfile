FROM node:20-slim AS base

# --- Build stage ---
FROM base AS builder
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./
COPY apps/server/package.json ./apps/server/

# Install all dependencies (including devDeps for tsc)
RUN npm ci --workspace=apps/server --include-workspace-root

# Copy server source + docs
COPY apps/server ./apps/server
COPY docs ./docs

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

# Copy compiled output + docs
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/docs ./docs

# Dedicated directory for session file (persists kite token across restarts)
RUN mkdir -p /app/apps/server/data
VOLUME /app/apps/server/data

WORKDIR /app/apps/server

EXPOSE 4000

CMD ["node", "dist/index.js"]
