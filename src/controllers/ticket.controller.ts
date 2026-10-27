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
      if (req.user?.role === 'ADMIN') {
        res.status(403).json({
          success: false,
          message: 'Los administradores no pueden adquirir pases ni participar en sorteos. Tu rol es exclusivo para gestión de salas y pagos.',
        });
        return;
      }

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
   * Confirma una transacción por referencia cuando el usuario regresa de Wompi o completa el flujo
   */
  public static async confirmPayment(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user!.id;
      const { reference } = req.body;

      if (!reference) {
        res.status(400).json({ success: false, message: 'La referencia de transacción es requerida.' });
        return;
      }

      const result = await WompiService.confirmTransactionByReference(userId, reference);

      res.json({
        message: '¡Pago confirmado! Pase digital emitido exitosamente.',
        ...result,
      });
    } catch (error: any) {
      console.error('Error en confirmPayment:', error.message);
      res.status(400).json({
        success: false,
        message: error.message || 'Error al confirmar la transacción de Wompi.',
      });
    }
  }

  /**
   * Obtiene el pase digital del usuario para una sala específica
   */
  public static async getMyPassForRoom(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (req.user?.role === 'ADMIN') {
        res.json({
          success: true,
          ticket: null,
          isAdmin: true,
          message: 'La cuenta de administrador no participa en sorteos ni posee pases.',
        });
        return;
      }

      const userId = req.user!.id;
      const { roomId } = req.params;

      const ticket = await prisma.ticket.findFirst({
        where: {
          userId,
          roomId,
        },
        include: {
          room: {
            include: {
              sorteo: true,
            },
          },
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

  /**
   * Ejecuta una compra directa de pase mediante Transacción de Compra Wompi
   */
  public static async payWithCard(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (req.user?.role === 'ADMIN') {
        res.status(403).json({
          success: false,
          message: 'Los administradores no pueden adquirir pases ni participar en sorteos. Tu rol es exclusivo para gestión de salas y pagos.',
        });
        return;
      }

      const userId = req.user!.id;
      const { roomId, cardData } = req.body;

      if (!roomId) {
        res.status(400).json({ success: false, message: 'El ID de la sala es obligatorio.' });
        return;
      }

      const result = await WompiService.executePurchaseTransaction(userId, roomId, cardData);

      res.json({
        message: '¡Transacción aprobada! Pase digital emitido exitosamente.',
        ...result,
      });
    } catch (error: any) {
      console.error('Error en payWithCard:', error.message);
      res.status(400).json({
        success: false,
        message: error.message || 'Error al procesar la compra del pase digital.',
      });
    }
  }
}

