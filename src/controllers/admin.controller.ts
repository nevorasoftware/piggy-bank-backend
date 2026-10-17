import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { SorteoService } from '../services/sorteo.service';
import { getElSalvadorDateString } from '../utils/date';
import { RoomStatus, TransactionStatus } from '@prisma/client';
import { broadcastRoomUpdate } from '../socket/socket.handler';

export class AdminController {
  /**
   * Métricas generales del Dashboard Administrativo
   */
  public static async getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const todayStr = getElSalvadorDateString();

      // Contadores globales
      const [
        totalTicketsSold,
        totalRevenueAggregate,
        totalUsers,
        activeRoomsCount,
        pendingPayoutsCount,
      ] = await Promise.all([
        prisma.ticket.count(),
        prisma.transaction.aggregate({
          where: { status: TransactionStatus.APPROVED },
          _sum: { amount: true },
        }),
        prisma.user.count(),
        prisma.room.count({
          where: { estado: { in: [RoomStatus.ABIERTA, RoomStatus.LLENA] } },
        }),
        prisma.sorteo.count({
          where: { estadoPago: 'PENDIENTE' },
        }),
      ]);

      // Métricas de hoy
      const todayStats = await prisma.dailyUserStats.findMany({
        where: { fecha: todayStr },
      });

      const ticketsToday = todayStats.reduce((acc, curr) => acc + curr.participaciones, 0);

      res.json({
        success: true,
        metrics: {
          totalTicketsSold,
          totalRevenue: Number(totalRevenueAggregate._sum.amount || 0),
          totalUsers,
          activeRoomsCount,
          pendingPayoutsCount,
          ticketsToday,
          date: todayStr,
        },
      });
    } catch (error) {
      console.error('Error en getMetrics:', error);
      res.status(500).json({ success: false, message: 'Error al obtener métricas del dashboard.' });
    }
  }

  /**
   * CRUD Salas: Listar todas las salas (incluye cerradas y finalizadas)
   */
  public static async listAllRooms(req: Request, res: Response): Promise<void> {
    try {
      const rooms = await prisma.room.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { tickets: true },
          },
          sorteo: true,
        },
      });

      res.json({ success: true, rooms });
    } catch (error) {
      console.error('Error en listAllRooms:', error);
      res.status(500).json({ success: false, message: 'Error al listar salas.' });
    }
  }

  /**
   * CRUD Salas: Crear nueva sala de sorteo
   */
  public static async createRoom(req: Request, res: Response): Promise<void> {
    try {
      const {
        nombre,
        premio,
        costoPase,
        capacidadMax,
        horaApertura,
        horaSorteo,
      } = req.body;

      if (!nombre || !premio || !costoPase || !capacidadMax || !horaApertura || !horaSorteo) {
        res.status(400).json({
          success: false,
          message: 'Todos los campos de la sala son obligatorios.',
        });
        return;
      }

      const room = await prisma.room.create({
        data: {
          nombre,
          premio: Number(premio),
          costoPase: Number(costoPase),
          capacidadMax: parseInt(capacidadMax, 10),
          horaApertura: new Date(horaApertura),
          horaSorteo: new Date(horaSorteo),
          estado: RoomStatus.ABIERTA,
        },
      });

      broadcastRoomUpdate(room.id, { room, action: 'created' });

      res.status(201).json({
        success: true,
        message: 'Sala de sorteo creada exitosamente.',
        room,
      });
    } catch (error) {
      console.error('Error en createRoom:', error);
      res.status(500).json({ success: false, message: 'Error al crear la sala.' });
    }
  }

  /**
   * CRUD Salas: Actualizar sala existente
   */
  public static async updateRoom(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const {
        nombre,
        premio,
        costoPase,
        capacidadMax,
        horaApertura,
        horaSorteo,
        estado,
      } = req.body;

      const updated = await prisma.room.update({
        where: { id },
        data: {
          nombre,
          premio: premio !== undefined ? Number(premio) : undefined,
          costoPase: costoPase !== undefined ? Number(costoPase) : undefined,
          capacidadMax: capacidadMax !== undefined ? parseInt(capacidadMax, 10) : undefined,
          horaApertura: horaApertura ? new Date(horaApertura) : undefined,
          horaSorteo: horaSorteo ? new Date(horaSorteo) : undefined,
          estado: estado ? (estado as RoomStatus) : undefined,
        },
      });

      broadcastRoomUpdate(updated.id, { room: updated, action: 'updated' });

      res.json({
        success: true,
        message: 'Sala actualizada exitosamente.',
        room: updated,
      });
    } catch (error) {
      console.error('Error en updateRoom:', error);
      res.status(500).json({ success: false, message: 'Error al actualizar la sala.' });
    }
  }

  /**
   * CRUD Salas: Eliminar sala (si no tiene sorteo finalizado)
   */
  public static async deleteRoom(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const room = await prisma.room.findUnique({
        where: { id },
        include: { sorteo: true, tickets: true },
      });

      if (!room) {
        res.status(404).json({ success: false, message: 'Sala no encontrada.' });
        return;
      }

      if (room.tickets.length > 0) {
        res.status(400).json({
          success: false,
          message: 'No se puede eliminar una sala con boletos ya comprados. Puedes cancelarla o finalizarla.',
        });
        return;
      }

      await prisma.room.delete({ where: { id } });

      res.json({ success: true, message: 'Sala eliminada exitosamente.' });
    } catch (error) {
      console.error('Error en deleteRoom:', error);
      res.status(500).json({ success: false, message: 'Error al eliminar sala.' });
    }
  }

  /**
   * Forzar ejecución manual de un sorteo desde el panel de control
   */
  public static async triggerRoomDraw(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const sorteo = await SorteoService.ejecutarSorteo(id);

      res.json({
        success: true,
        message: 'Sorteo ejecutado exitosamente con ruleta en vivo.',
        sorteo,
      });
    } catch (error: any) {
      console.error('Error en triggerRoomDraw:', error.message);
      res.status(400).json({
        success: false,
        message: error.message || 'Error al ejecutar sorteo.',
      });
    }
  }

  /**
   * Configuración de Reglas: Obtener valores actuales (6/3)
   */
  public static async getGameConfig(req: Request, res: Response): Promise<void> {
    try {
      let config = await prisma.gameConfig.findFirst({ where: { id: 1 } });
      if (!config) {
        config = await prisma.gameConfig.create({
          data: { id: 1, maxParticipacionesDia: 6, maxVictoriasDia: 3 },
        });
      }

      res.json({ success: true, config });
    } catch (error) {
      console.error('Error en getGameConfig:', error);
      res.status(500).json({ success: false, message: 'Error al obtener GameConfig.' });
    }
  }

  /**
   * Configuración de Reglas: Actualizar límites MAX_PARTICIPACIONES_DIA y MAX_VICTORIAS_DIA
   */
  public static async updateGameConfig(req: Request, res: Response): Promise<void> {
    try {
      const { maxParticipacionesDia, maxVictoriasDia } = req.body;

      if (maxParticipacionesDia === undefined || maxVictoriasDia === undefined) {
        res.status(400).json({
          success: false,
          message: 'Valores de maxParticipacionesDia y maxVictoriasDia son requeridos.',
        });
        return;
      }

      const updated = await prisma.gameConfig.upsert({
        where: { id: 1 },
        update: {
          maxParticipacionesDia: parseInt(maxParticipacionesDia, 10),
          maxVictoriasDia: parseInt(maxVictoriasDia, 10),
        },
        create: {
          id: 1,
          maxParticipacionesDia: parseInt(maxParticipacionesDia, 10),
          maxVictoriasDia: parseInt(maxVictoriasDia, 10),
        },
      });

      res.json({
        success: true,
        message: 'Reglas de participación actualizadas exitosamente.',
        config: updated,
      });
    } catch (error) {
      console.error('Error en updateGameConfig:', error);
      res.status(500).json({ success: false, message: 'Error al actualizar reglas.' });
    }
  }

  /**
   * Gestión de Usuarios: Listado completo con DUI, teléfono y datos bancarios
   */
  public static async getUsers(req: Request, res: Response): Promise<void> {
    try {
      const users = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          bankAccount: true,
          _count: {
            select: { tickets: true, sorteosGanados: true },
          },
        },
      });

      res.json({ success: true, users });
    } catch (error) {
      console.error('Error en getUsers:', error);
      res.status(500).json({ success: false, message: 'Error al obtener lista de usuarios.' });
    }
  }

  /**
   * Historial de Sorteos: Listar ganadores y estados de pago
   */
  public static async getSorteos(req: Request, res: Response): Promise<void> {
    try {
      const sorteos = await SorteoService.getHistorialSorteos();
      res.json({ success: true, sorteos });
    } catch (error) {
      console.error('Error en getSorteos:', error);
      res.status(500).json({ success: false, message: 'Error al listar sorteos.' });
    }
  }

  /**
   * Botón "Pago Aplicado": Marcar sorteo como pagado y enviar notificación
   */
  public static async applyPayout(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { notas } = req.body;

      const sorteo = await SorteoService.marcarPagoAplicado(id, notas);

      res.json({
        success: true,
        message: 'Pago marcado como APLICADO exitosamente. Ganador notificado por WhatsApp.',
        sorteo,
      });
    } catch (error: any) {
      console.error('Error en applyPayout:', error.message);
      res.status(400).json({
        success: false,
        message: error.message || 'Error al aplicar pago.',
      });
    }
  }
}
