import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { RoomStatus, TicketStatus } from '@prisma/client';
import { SorteoService } from '../services/sorteo.service';
import { broadcastRoomUpdate } from '../socket/socket.handler';

export class RoomController {
  /**
   * Obtiene la lista de salas disponibles para sorteo
   */
  public static async getRooms(req: Request, res: Response): Promise<void> {
    try {
      const rooms = await prisma.room.findMany({
        where: {
          estado: {
            in: [RoomStatus.ABIERTA, RoomStatus.LLENA, RoomStatus.SORTEANDO],
          },
        },
        orderBy: { horaSorteo: 'asc' },
        include: {
          _count: {
            select: { tickets: true },
          },
        },
      });

      res.json({ success: true, rooms });
    } catch (error) {
      console.error('Error en getRooms:', error);
      res.status(500).json({ success: false, message: 'Error al obtener salas.' });
    }
  }

  /**
   * Obtiene los detalles de una sala específica
   */
  public static async getRoomById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const room = await prisma.room.findUnique({
        where: { id },
        include: {
          tickets: {
            select: {
              id: true,
              ticketNumber: true,
              estado: true,
              createdAt: true,
            },
          },
          sorteo: {
            include: {
              ganador: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
            },
          },
        },
      });

      if (!room) {
        res.status(404).json({ success: false, message: 'Sala no encontrada.' });
        return;
      }

      res.json({ success: true, room });
    } catch (error) {
      console.error('Error en getRoomById:', error);
      res.status(500).json({ success: false, message: 'Error al consultar sala.' });
    }
  }

  /**
   * Dispara el sorteo de una sala si ya se alcanzó la hora programada
   * (llamado automáticamente desde el cliente cuando el contador llega a cero).
   */
  public static async autoDrawRoomIfReady(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const room = await prisma.room.findUnique({
        where: { id },
        include: {
          tickets: {
            where: { estado: TicketStatus.ACTIVO },
          },
          sorteo: true,
        },
      });

      if (!room) {
        res.status(404).json({ success: false, message: 'Sala no encontrada.' });
        return;
      }

      if (room.estado === RoomStatus.FINALIZADA) {
        res.json({ success: true, message: 'La sala ya finalizó.', room });
        return;
      }

      if (room.estado === RoomStatus.SORTEANDO) {
        res.json({ success: true, message: 'La sala está en proceso de sorteo.', room });
        return;
      }

      const now = new Date();
      // Permitir si la hora del sorteo ya llegó o está a menos de 5 segundos de llegar
      if (new Date(room.horaSorteo).getTime() > now.getTime() + 5000) {
        res.status(400).json({
          success: false,
          message: 'Aún no es la hora programada para el sorteo de esta sala.',
        });
        return;
      }

      if (room.tickets.length === 0) {
        await prisma.room.update({
          where: { id: room.id },
          data: { estado: RoomStatus.CERRADA },
        });
        broadcastRoomUpdate(room.id, {
          room: { ...room, estado: RoomStatus.CERRADA },
          action: 'closed',
        });
        res.json({ success: true, message: 'La sala fue cerrada sin participantes.' });
        return;
      }

      const sorteo = await SorteoService.ejecutarSorteo(room.id);
      res.json({
        success: true,
        message: 'Sorteo ejecutado exitosamente con ruleta en tiempo real.',
        sorteo,
      });
    } catch (error: any) {
      console.error('Error en autoDrawRoomIfReady:', error.message);
      res.status(500).json({
        success: false,
        message: error.message || 'Error al ejecutar sorteo automático.',
      });
    }
  }
}

