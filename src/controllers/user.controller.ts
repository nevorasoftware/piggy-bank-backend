import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middlewares/auth.middleware';
import { puedeParticipar } from '../middlewares/participation.middleware';
import { AccountType } from '@prisma/client';

export class UserController {
  /**
   * Actualizar o registrar cuenta bancaria para cobro de premios
   */
  public static async updateBankAccount(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { bankName, accountType, accountNumber, accountHolder } = req.body;

      if (!bankName || !accountNumber) {
        res.status(400).json({
          success: false,
          message: 'El nombre del banco y el número de cuenta son obligatorios.',
        });
        return;
      }

      const parsedType =
        accountType === 'CORRIENTE' ? AccountType.CORRIENTE : AccountType.AHORRO;

      const bankAccount = await prisma.bankAccount.upsert({
        where: { userId },
        update: {
          bankName,
          accountType: parsedType,
          accountNumber,
          accountHolder,
        },
        create: {
          userId,
          bankName,
          accountType: parsedType,
          accountNumber,
          accountHolder,
        },
      });

      res.json({
        success: true,
        message: 'Cuenta bancaria guardada exitosamente.',
        bankAccount,
      });
    } catch (error) {
      console.error('Error en updateBankAccount:', error);
      res.status(500).json({ success: false, message: 'Error al actualizar cuenta bancaria.' });
    }
  }

  /**
   * Consultar estado y límites de participación del usuario para el día de hoy
   */
  public static async getParticipationStatus(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const check = await puedeParticipar(userId);

      res.json({
        success: true,
        allowed: check.allowed,
        reason: check.reason || null,
        stats: check.stats,
      });
    } catch (error) {
      console.error('Error en getParticipationStatus:', error);
      res.status(500).json({ success: false, message: 'Error al consultar reglas de participación.' });
    }
  }

  /**
   * Obtener historial de pases digitales / boletos del usuario
   */
  public static async getMyTickets(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;

      const tickets = await prisma.ticket.findMany({
        where: { userId },
        include: {
          room: {
            include: {
              sorteo: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, tickets });
    } catch (error) {
      console.error('Error en getMyTickets:', error);
      res.status(500).json({ success: false, message: 'Error al obtener boletos.' });
    }
  }
}
