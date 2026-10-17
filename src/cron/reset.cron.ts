import cron from 'node-cron';
import { prisma } from '../config/database';
import { getElSalvadorDateString } from '../utils/date';
import { io } from '../socket/socket.handler';

/**
 * Cron Job para el reseteo diario y sincronización a las 00:00 TZ America/El_Salvador.
 */
export function initDailyResetCron(): void {
  // Expresión: 0 0 * * * -> Todos los días a medianoche (00:00)
  cron.schedule(
    '0 0 * * *',
    async () => {
      const today = getElSalvadorDateString();
      console.log(`⏰ [CRON 00:00 TZ America/El_Salvador] Iniciando ciclo diario para: ${today}`);

      try {
        // 1. Obtener conteo de usuarios y actividad del día anterior
        const activeUsersCount = await prisma.user.count();
        console.log(`📊 Total de usuarios registrados en la plataforma: ${activeUsersCount}`);

        // 2. Emitir evento global por WebSockets para que los clientes conectados
        // reseteen sus contadores de participaciones en la interfaz inmediatamente
        if (io) {
          io.emit('daily_reset', {
            date: today,
            message: 'Nuevo día iniciado. Tus límites de participación han sido restablecidos.',
          });
          console.log('📡 Evento daily_reset emitido a todos los sockets conectados.');
        }

        console.log(`✅ [CRON] Ciclo diario finalizado con éxito para ${today}`);
      } catch (error) {
        console.error('❌ Error en ejecución del cron de reseteo diario:', error);
      }
    },
    {
      timezone: 'America/El_Salvador',
    }
  );

  console.log('🕒 Cron Job de reseteo diario registrado para las 00:00 (America/El_Salvador).');
}
