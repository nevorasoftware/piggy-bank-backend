import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { WompiService } from '../services/wompi.service';
import { prisma } from '../config/database';

export class TicketController {
  /**
   * Genera una sesión de pago con Wompi para adquirir un boleto de sala.
   * La petición ya viene validada por el middleware de participación (reglas 6/3).
   */
  public static async initiateCheckout(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { roomId } = req.body;

      if (!roomId) {
        res.status(400).json({ success: false, message: 'El ID de la sala es obligatorio.' });
        return;
      }

      const checkoutData = await WompiService.createPaymentSession(userId, roomId);

      res.json({
        success: true,
        message: 'Sesión de pago con Wompi generada.',
        checkout: checkoutData,
      });
    } catch (error: any) {
      console.error('Error en initiateCheckout:', error.message);
      res.status(400).json({
        success: false,
        message: error.message || 'Error al iniciar pago con Wompi.',
      });
    }
  }

  /**
   * Obtiene el pase digital del usuario para una sala específica
   */
  public static async getMyPassForRoom(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { roomId } = req.params;

      const ticket = await prisma.ticket.findFirst({
        where: {
          userId,
          roomId,
        },
        include: {
          room: true,
          user: {
            select: {
              fullName: true,
              dui: true,
            },
          },
        },
      });

      if (!ticket) {
        res.status(404).json({ success: false, message: 'No posees un boleto activo en esta sala.' });
        return;
      }

      res.json({ success: true, ticket });
    } catch (error) {
      console.error('Error en getMyPassForRoom:', error);
      res.status(500).json({ success: false, message: 'Error al consultar boleto de sala.' });
    }
  }
}
