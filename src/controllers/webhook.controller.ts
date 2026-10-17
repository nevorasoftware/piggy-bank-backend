import { Request, Response } from 'express';
import { WompiService } from '../services/wompi.service';

export class WebhookController {
  /**
   * Endpoint oficial para recepción de webhooks de Wompi El Salvador.
   * Valida firma HMAC, ejecuta el middleware/reglas puedeParticipar y asigna el pase.
   * URL de destino: https://<backend-url>/api/webhooks/wompi
   */
  public static async handleWompiWebhook(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body;
      const signatureHeader =
        (req.headers['x-event-checksum'] as string) ||
        (req.headers['signature'] as string) ||
        (req.headers['x-wompi-signature'] as string);

      const result = await WompiService.processWebhook(payload, signatureHeader);

      // Responder 200 a Wompi para confirmar recepción
      res.status(200).json({
        success: true,
        received: true,
        result,
      });
    } catch (error: any) {
      console.error('❌ Error al procesar Webhook de Wompi:', error.message);
      // Responder con código adecuado para evitar reintentos infinitos si la firma es falsa
      res.status(400).json({
        success: false,
        message: error.message || 'Error al procesar evento de Wompi.',
      });
    }
  }
}
