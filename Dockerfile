# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://postgres:postgres@db:5432/app_db
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Optional: system Chromium for the Playwright stealth fallback (Mode B).
# Uncomment to bake it into the image (~400 MB):
# RUN apt-get update && apt-get install -y --no-install-recommends chromium && rm -rf /var/lib/apt/lists/*
# ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "npx drizzle-kit push --force && npm run start"]
