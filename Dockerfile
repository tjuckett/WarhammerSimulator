# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libcairo2 \
    libgif7 \
    libjpeg62-turbo \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    librsvg2-2 \
  && rm -rf /var/lib/apt/lists/*

FROM base AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    g++ \
    make \
    pkg-config \
    python3 \
    libcairo2-dev \
    libgif-dev \
    libjpeg-dev \
    libpango1.0-dev \
    librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/simulator-core/package.json ./packages/simulator-core/package.json

RUN npm ci

FROM deps AS builder

COPY . .

RUN npm run db:generate
RUN npm run build

FROM base AS runner

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/scripts/docker-start.mjs ./scripts/docker-start.mjs
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/prisma ./apps/web/prisma
COPY --from=builder /app/apps/web/prisma.config.ts ./apps/web/prisma.config.ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "scripts/docker-start.mjs"]
