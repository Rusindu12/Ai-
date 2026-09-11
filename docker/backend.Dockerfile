# Backend (Node.js / Express)
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY backend/ ./

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/server.js"]
