import cron from 'node-cron';
import { prisma } from '../config/database';
import { RoomStatus, TicketStatus } from '@prisma/client';
import { SorteoService } from '../services/sorteo.service';
import { broadcastRoomUpdate } from '../socket/socket.handler';

let isRunning = false;

/**
 * Cron Job que monitorea salas de sorteo expiradas cada 10 segundos
 * y ejecuta el sorteo automáticamente cuando el temporizador finaliza.
 */
export function initAutoDrawCron(): void {
  // Ejecuta cada 10 segundos
  cron.schedule('*/10 * * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const now = new Date();

      const expiredRooms = await prisma.room.findMany({
        where: {
          estado: { in: [RoomStatus.ABIERTA, RoomStatus.LLENA] },
          horaSorteo: { lte: now },
        },
        include: {
          tickets: {
            where: { estado: TicketStatus.ACTIVO },
          },
        },
      });

      for (const room of expiredRooms) {
        try {
          if (room.tickets.length > 0) {
            console.log(`🎰 [AUTO-DRAW] Ejecutando sorteo programado para sala "${room.nombre}" (${room.id})...`);
            await SorteoService.ejecutarSorteo(room.id);
          } else {
            console.log(`🔒 [AUTO-DRAW] Cerrando sala sin participantes "${room.nombre}" (${room.id})...`);
            await prisma.room.update({
              where: { id: room.id },
              data: { estado: RoomStatus.CERRADA },
            });
            broadcastRoomUpdate(room.id, {
              room: { ...room, estado: RoomStatus.CERRADA },
              action: 'closed',
            });
          }
        } catch (roomErr: any) {
          console.error(`❌ [AUTO-DRAW] Error al procesar sorteo de sala ${room.id}:`, roomErr.message);
        }
      }
    } catch (error) {
      console.error('❌ Error general en cron de Auto-Draw:', error);
    } finally {
      isRunning = false;
    }
  });

  console.log('🎰 Cron de Sorteo Automático iniciado (revisión cada 10 segundos).');
}
