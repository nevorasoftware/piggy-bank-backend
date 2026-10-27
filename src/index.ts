import http from 'http';
import { createApp } from './app';
import { ENV } from './config/env';
import { initSocketIO } from './socket/socket.handler';
import { initDailyResetCron } from './cron/reset.cron';
import { initAutoDrawCron } from './cron/draw.cron';
import { prisma } from './config/database';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { EmailService } from './services/email.service';

async function ensureAdminUser() {
  try {
    // Inicializar configuración de correo con credenciales de Gmail OAuth
    await EmailService.getEmailConfig().catch((err) =>
      console.warn('⚠️ No se pudo inicializar EmailService:', err.message)
    );
    const adminEmail = 'admin@piggybank.com';
    const hashedPassword = await bcrypt.hash('Gacela@2305', 10);

    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        password: hashedPassword,
        role: Role.ADMIN,
        emailVerified: true,
        phoneVerified: true,
      },
      create: {
        fullName: 'Administrador PiggyBank',
        email: adminEmail,
        phone: '+50370001122',
        dui: '01234567-8',
        password: hashedPassword,
        role: Role.ADMIN,
        emailVerified: true,
        phoneVerified: true,
      },
    });
    console.log('👑 [Auth] Cuenta Administrador lista: admin@piggybank.com / Gacela@2305');

    // Asegurar también rol ADMIN para jgiron.ing@gmail.com si existe
    const personalAccount = await prisma.user.findFirst({
      where: { email: { equals: 'jgiron.ing@gmail.com', mode: 'insensitive' } },
    });
    if (personalAccount && personalAccount.role !== Role.ADMIN) {
      await prisma.user.update({
        where: { id: personalAccount.id },
        data: { role: Role.ADMIN, emailVerified: true },
      });
      console.log('👑 [Auth] Cuenta jgiron.ing@gmail.com promovida a ADMIN exitosamente.');
    }
  } catch (error) {
    console.error('⚠️ [Auth] Error en ensureAdminUser:', error);
  }
}

async function bootstrap() {
  const app = createApp();
  const server = http.createServer(app);

  // Inicializar Socket.io sobre el servidor HTTP
  initSocketIO(server);

  // Inicializar Cron Job de reseteo a las 00:00 (America/El_Salvador)
  initDailyResetCron();

  // Inicializar Cron Job de sorteo automático para cuando expire el temporizador
  initAutoDrawCron();

  // Asegurar cuenta de administración en la base de datos
  await ensureAdminUser();

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
