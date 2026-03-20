FROM node:20-slim AS base

# --- Build stage ---
FROM base AS builder
WORKDIR /app

# NEXT_PUBLIC_* vars must be present at build time
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/

# Install all dependencies
RUN npm ci --workspace=apps/web --include-workspace-root

# Copy web source
COPY apps/web ./apps/web

# Build Next.js (standalone output)
RUN npm run build -w apps/web

# --- Production stage ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
