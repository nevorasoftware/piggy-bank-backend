# 🐷 PiggyBank Backend API

Servicio Backend de alta concurrencia para la plataforma de sorteos y casino web **PiggyBank**, con validación de identidad salvadoreña (DUI), pagos seguros mediante Wompi El Salvador, notificaciones automatizadas por WhatsApp Business Cloud API, reglas parametrizables de juego responsable (6 participaciones / 3 victorias al día) y sincronización en tiempo real vía Socket.io.

* **Repositorio GitHub:** [https://github.com/nevorasoftware/piggy-bank-backend.git](https://github.com/nevorasoftware/piggy-bank-backend.git)
* **Frontend Relacionado:** [https://github.com/nevorasoftware/piggy-bank-frontend.git](https://github.com/nevorasoftware/piggy-bank-frontend.git)

---

## 🛠️ Stack Tecnológico

* **Lenguaje & Framework:** Node.js 20+ con TypeScript y Express.
* **ORM & Base de Datos:** Prisma ORM conectando a PostgreSQL (Plugin Railway).
* **WebSockets en Tiempo Real:** Socket.io para sincronización de salas, boletos y ruleta animada.
* **Pasarela de Pagos:** API oficial de Wompi El Salvador ([https://docs.wompi.sv/](https://docs.wompi.sv/)).
* **Mensajería:** Meta WhatsApp Business Cloud API.
* **Seguridad:** JWT, bcryptjs, validación HMAC SHA-256 para webhooks, validador de dígito verificador de DUI.
* **Tareas Programadas:** node-cron con zona horaria estricta `America/El_Salvador` (00:00 reseteo).

---

## 🚀 Despliegue en Railway (Paso a Paso)

Este servicio está 100% preconfigurado para Railway usando el archivo `railway.json` y el `Dockerfile` multi-stage con healthcheck en `/api/health`.

### 1. Crear el Proyecto en Railway
1. Inicia sesión en [Railway](https://railway.app/).
2. Haz clic en **"New Project"**.
3. Selecciona **"Provision PostgreSQL"** (Railway creará el servicio de base de datos gestionada).

### 2. Conectar el Repositorio del Backend
1. En el mismo proyecto de Railway, haz clic en **"New"** -> **"GitHub Repo"**.
2. Selecciona `nevorasoftware/piggy-bank-backend`.
3. Railway detectará automáticamente el archivo `railway.json` y el `Dockerfile`.

### 3. Configurar Variables de Entorno en Railway
En la pestaña **Variables** del servicio `piggy-bank-backend`, Railway inyectará automáticamente `DATABASE_URL`. Añade las siguientes variables:

| Variable | Descripción | Ejemplo / Valor |
| :--- | :--- | :--- |
| `DATABASE_URL` | Inyectada automáticamente por el plugin de PostgreSQL | `postgresql://postgres:...` |
| `PORT` | Asignado automáticamente por Railway | `3000` |
| `NODE_ENV` | Entorno de ejecución | `production` |
| `JWT_SECRET` | Clave secreta para tokens JWT | `tu_clave_secreta_super_segura` |
| `WOMPI_PUBLIC_KEY` | Llave pública de Wompi SV | `pub_prod_xxxxxxxxxxxx` |
| `WOMPI_PRIVATE_KEY` | Llave privada de Wompi SV | `prv_prod_xxxxxxxxxxxx` |
| `WOMPI_EVENTS_SECRET` | Secreto para validación HMAC de webhooks | `events_sec_xxxxxxxxxxxx` |
| `WOMPI_BASE_URL` | URL base de Wompi | `https://production.wompi.sv` |
| `WHATSAPP_TOKEN` | Token de acceso de Meta Developers | `EAAG...` |
| `WHATSAPP_PHONE_ID` | Phone Number ID en Meta Developer Portal | `123456789012345` |
| `FRONTEND_URL` | Dominio público del frontend en Railway | `https://piggy-bank-frontend.up.railway.app` |
| `TZ` | Zona horaria oficial | `America/El_Salvador` |

### 4. Generar Dominio Público
1. En la pestaña **Settings** del servicio en Railway, ve a **Networking**.
2. Haz clic en **"Generate Domain"** (por ejemplo: `piggy-bank-backend.up.railway.app`).

### 5. Configurar el Webhook en Wompi
En el portal administrativo de Wompi El Salvador ([https://wompi.sv/](https://wompi.sv/)), registra la siguiente URL de eventos:
```text
https://<tu-backend-url>.up.railway.app/api/webhooks/wompi
```

### 6. Ejecutar Seed Inicial (Opcional pero Recomendado)
Para crear el usuario administrador inicial (`admin@piggybank.sv` / `AdminPiggy2026!`) y las primeras salas:
* Desde Railway CLI: `railway run npm run seed`
* O vía consola web de Railway en el contenedor.

---

## 💻 Desarrollo Local

### Requisitos Previos
* Node.js v20 o superior
* Docker y Docker Compose (para PostgreSQL local)

```bash
# 1. Clonar el repositorio
git clone https://github.com/nevorasoftware/piggy-bank-backend.git
cd piggy-bank-backend

# 2. Instalar dependencias
npm install

# 3. Iniciar base de datos local con docker-compose
docker-compose up -d

# 4. Configurar variables de entorno locales
cp .env.example .env
# Modifica .env con: DATABASE_URL="postgresql://postgres:password@localhost:5432/piggybank?schema=public"

# 5. Generar cliente Prisma y aplicar migraciones
npx prisma generate
npx prisma migrate dev --name init

# 6. Sembrar datos de prueba
npm run seed

# 7. Iniciar en modo desarrollo
npm run dev
```

El servidor estará activo en `http://localhost:3000` con el healthcheck en `http://localhost:3000/api/health`.

---

## 📦 Comandos Git de Inicialización y Publicación

Para inicializar y enviar este repositorio a GitHub:

```bash
cd /Users/jgiron/Documents/PiggyBank/piggy-bank-backend
git init
git remote add origin https://github.com/nevorasoftware/piggy-bank-backend.git
git add .
git commit -m "feat: arquitectura completa de backend PiggyBank con Railway, Prisma, Wompi y WhatsApp"
git branch -M main
git push -u origin main
```
