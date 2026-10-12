# ---------- Frontend ----------
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Backend ----------
FROM node:22-alpine AS backend
RUN apk add --no-cache openssl
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npx prisma generate && npm run build

# ---------- Runtime ----------
FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production PORT=3000 PUBLIC_DIR=/app/public
# Giữ nguyên node_modules (có prisma CLI + ts-node) để chạy được migrate và seed trong container.
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/prisma ./prisma
COPY --from=backend /app/package.json /app/tsconfig.json ./
COPY --from=frontend /app/dist ./public
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
