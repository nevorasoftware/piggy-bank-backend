import axios from 'axios';
import { ENV } from '../config/env';

/**
 * Servicio de mensajería con WhatsApp Business Cloud API (Meta)
 */
export class WhatsAppService {
  private static baseUrl = `https://graph.facebook.com/v19.0/${ENV.WHATSAPP_PHONE_ID}/messages`;

  private static getHeaders() {
    return {
      Authorization: `Bearer ${ENV.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Envía un mensaje de texto libre a través de WhatsApp Cloud API.
   * Si no hay credenciales configuradas en desarrollo, realiza log en consola.
   */
  public static async sendTextMessage(to: string, message: string): Promise<boolean> {
    // Formatear número de teléfono salvadoreño: debe incluir código de país sin '+' ni espacios
    let formattedPhone = to.replace(/[\s+-]/g, '');
    if (!formattedPhone.startsWith('503')) {
      formattedPhone = `503${formattedPhone}`;
    }

    if (!ENV.WHATSAPP_TOKEN || !ENV.WHATSAPP_PHONE_ID) {
      console.log(`📱 [WhatsApp Mock - Desarrollo] Para: +${formattedPhone} | Mensaje:\n${message}`);
      return true;
    }

    try {
      const response = await axios.post(
        this.baseUrl,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: 'text',
          text: {
            preview_url: false,
            body: message,
          },
        },
        { headers: this.getHeaders() }
      );

      return response.status === 200 || response.status === 201;
    } catch (error: any) {
      console.error('❌ Error al enviar mensaje por WhatsApp Cloud API:', error?.response?.data || error.message);
      return false;
    }
  }

  /**
   * 1. Enviar código OTP de verificación por WhatsApp
   */
  public static async sendOtpCode(to: string, code: string): Promise<boolean> {
    const text = `🐷 *PiggyBank El Salvador*\n\nTu código de verificación de seguridad es: *${code}*.\n\nVálido durante los próximos 10 minutos. No compartas este código con nadie.`;
    return this.sendTextMessage(to, text);
  }

  /**
   * 2. Confirmación de compra de Pase Digital
   */
  public static async sendTicketConfirmation(
    to: string,
    userName: string,
    roomName: string,
    ticketNumber: string,
    drawTime: string
  ): Promise<boolean> {
    const text = `🐷 *¡Pase Digital Confirmado! - PiggyBank*\n\nHola ${userName},\nya tienes tu boleto para el sorteo:\n\n🎟️ *Boleto:* ${ticketNumber}\n🏠 *Sala:* ${roomName}\n⏰ *Hora del Sorteo:* ${drawTime}\n\nEntra a la sala para vivir el sorteo en vivo y ver girar la ruleta. ¡Mucha suerte! 🍀`;
    return this.sendTextMessage(to, text);
  }

  /**
   * 3. Recordatorio 10 minutos antes del sorteo
   */
  public static async sendRoomReminder(to: string, roomName: string, minutesLeft: number = 10): Promise<boolean> {
    const text = `⏰ *¡Tu sorteo comienza en ${minutesLeft} minutos!*\n\nLa sala *${roomName}* está por cerrar sus puertas y la ruleta comenzará a girar.\n\n👉 Conéctate ahora en ${ENV.FRONTEND_URL} para ver el cerdito lanzar dinero en vivo.`;
    return this.sendTextMessage(to, text);
  }

  /**
   * 4. Notificación al ganador del sorteo
   */
  public static async sendWinnerNotification(
    to: string,
    userName: string,
    roomName: string,
    premio: number,
    bankInfo: string
  ): Promise<boolean> {
    const text = `🎉🎉 *¡FELICIDADES, ERES EL GANADOR!* 🎉🎉\n\nHola ${userName},\n¡El cerdito de PiggyBank eligió tu boleto en la sala *${roomName}*!\n\n💰 *Premio Ganado:* $${premio.toFixed(2)} USD\n🏦 *Destino:* Tu cuenta bancaria registrada (${bankInfo})\n\nNuestro equipo administrativo está procesando la transferencia. Te notificaremos en cuanto el pago sea aplicado.`;
    return this.sendTextMessage(to, text);
  }

  /**
   * 5. Notificación de consuelo a los participantes no ganadores
   */
  public static async sendNonWinnerNotification(to: string, roomName: string): Promise<boolean> {
    const text = `🐷 *PiggyBank - Resultado del Sorteo*\n\nEl sorteo de la sala *${roomName}* ha concluido.\n\nEn esta ocasión no resultaste premiado, pero nuevas salas con grandes bolsas acumuladas están abiertas ahora mismo.\n\n¡Inténtalo en la próxima sala y haz engordar tu alcancía! 🪙`;
    return this.sendTextMessage(to, text);
  }

  /**
   * 6. Confirmación de "Pago Aplicado" al ganador
   */
  public static async sendPayoutAppliedNotification(
    to: string,
    userName: string,
    monto: number,
    bankName: string,
    accountNumber: string
  ): Promise<boolean> {
    const text = `✅ *PAGO APLICADO CON ÉXITO - PiggyBank*\n\nHola ${userName},\nTu transferencia de *${monto.toFixed(2)} USD* ha sido completada hacia tu cuenta:\n\n🏦 *Banco:* ${bankName}\n💳 *Cuenta:* ${accountNumber}\n\nGracias por jugar de manera responsable en PiggyBank El Salvador. ¡Que lo disfrutes! 💰🐷`;
    return this.sendTextMessage(to, text);
  }
}
