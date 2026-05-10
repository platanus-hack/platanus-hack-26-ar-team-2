FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/
COPY brands/ ./brands/

RUN npx tsc

# ─── Production ───────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

COPY --from=builder /app/package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/brands ./brands

ENV NODE_ENV=production
ENV PORT=3001
ENV BRANDS_DIR=/app/brands

EXPOSE 3001

CMD ["node", "dist/index.js"]
