import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { RoomStatus } from '@prisma/client';

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
}
