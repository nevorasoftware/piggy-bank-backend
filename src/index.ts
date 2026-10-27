import http from 'http';
import { createApp } from './app';
import { ENV } from './config/env';
import { initSocketIO } from './socket/socket.handler';
import { initDailyResetCron } from './cron/reset.cron';
import { initAutoDrawCron } from './cron/draw.cron';
import { prisma } from './config/database';

async function bootstrap() {
  const app = createApp();
  const server = http.createServer(app);

  // Inicializar Socket.io sobre el servidor HTTP
  initSocketIO(server);

  // Inicializar Cron Job de reseteo a las 00:00 (America/El_Salvador)
  initDailyResetCron();

  // Inicializar Cron Job de sorteo automático para cuando expire el temporizador
  initAutoDrawCron();

  // Escuchar en el puerto dinámico de Railway en todas las interfaces de red (0.0.0.0)
  server.listen(ENV.PORT, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`🐷 PiggyBank Backend iniciado con éxito`);
    console.log(`🚀 Puerto: ${ENV.PORT}`);
    console.log(`🌍 Entorno: ${ENV.NODE_ENV}`);
    console.log(`⏰ Zona Horaria: ${ENV.TZ}`);
    console.log(`🔗 Healthcheck: http://localhost:${ENV.PORT}/api/health`);
    console.log(`====================================================`);
  });

  // Manejo de apagado elegante (Graceful Shutdown)
  const shutdown = async (signal: string) => {
    console.log(`🛑 Señal ${signal} recibida. Cerrando conexiones limpiamente...`);
    server.close(async () => {
      await prisma.$disconnect();
      console.log('🏁 Servidor HTTP y Prisma desconectados.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('❌ Error fatal al iniciar el backend:', err);
  process.exit(1);
});
