# Multi-stage Dockerfile para piggy-bank-backend optimizado para Railway
FROM node:20-alpine AS builder

WORKDIR /app

# Instalar dependencias del sistema necesarias para Prisma
RUN apk add --no-cache openssl libc6-compat

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma/

# Instalar todas las dependencias
RUN npm ci

# Generar cliente de Prisma
RUN npx prisma generate

# Copiar código fuente y configuración de TypeScript
COPY tsconfig.json ./
COPY src ./src/

# Compilar TypeScript a JavaScript
RUN npm run build

# Stage 2: Imagen de Producción liviana
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV TZ=America/El_Salvador

# Copiar package.json y prisma
COPY package*.json ./
COPY prisma ./prisma/

# Instalar únicamente dependencias de producción
RUN npm ci --only=production

# Re-generar cliente de Prisma en producción
RUN npx prisma generate

# Copiar código compilado desde el builder
COPY --from=builder /app/dist ./dist

# Puerto asignado dinámicamente por Railway
EXPOSE 3000 8080

CMD ["sh", "-c", "(npx prisma migrate resolve --applied 20261027000000_wompi_config 2>/dev/null || true) && (npx prisma migrate deploy || npx prisma db push) && node dist/index.js"]
