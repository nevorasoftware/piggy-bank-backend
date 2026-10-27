import nodemailer from 'nodemailer';
import { prisma } from '../config/database';

export interface EmailConfigData {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  senderName: string;
  isActive: boolean;
}

export class EmailService {
  /**
   * Obtiene la configuración de email activa desde PostgreSQL
   */
  public static async getEmailConfig(): Promise<EmailConfigData> {
    try {
      let config = await prisma.emailConfig.findUnique({
        where: { id: 1 },
      });

      if (!config) {
        config = await prisma.emailConfig.create({
          data: {
            id: 1,
            smtpHost: 'smtp.gmail.com',
            smtpPort: 465,
            smtpSecure: true,
            smtpUser: 'piggybanksv@gmail.com',
            smtpPass: '',
            senderName: 'PiggyBank El Salvador',
            isActive: true,
          },
        });
      }

      return {
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        smtpSecure: config.smtpSecure,
        smtpUser: config.smtpUser,
        smtpPass: config.smtpPass,
        senderName: config.senderName,
        isActive: config.isActive,
      };
    } catch (error) {
      console.error('Error al obtener EmailConfig de la BD, usando valores por defecto:', error);
      return {
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: 'piggybanksv@gmail.com',
        smtpPass: '',
        senderName: 'PiggyBank El Salvador',
        isActive: true,
      };
    }
  }

  /**
   * Crea un transporter de nodemailer según la configuración de la BD
   */
  private static async createTransporter() {
    const config = await this.getEmailConfig();
    const cleanPassword = (config.smtpPass || '').replace(/\s+/g, '');

    return {
      config,
      transporter: nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure, // true para puerto 465, false para 587
        auth: {
          user: config.smtpUser,
          pass: cleanPassword,
        },
      }),
    };
  }

  /**
   * Envía el correo con el código de verificación OTP al usuario registrado
   */
  public static async sendVerificationEmail(
    toEmail: string,
    code: string,
    fullName?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    console.log(`\n======================================================`);
    console.log(`✉️ [PiggyBank Email OTP] Para: ${toEmail} | Código: ${code}`);
    console.log(`======================================================\n`);

    try {
      const { config, transporter } = await this.createTransporter();

      if (!config.isActive) {
        console.warn('⚠️ El servicio de email está desactivado en la configuración.');
        return { success: false, error: 'Servicio de email desactivado.' };
      }

      if (!config.smtpPass) {
        console.warn('⚠️ No se ha configurado la Contraseña de Aplicación de Gmail en el panel admin.');
        return {
          success: false,
          error: 'Falta configurar el token/contraseña de aplicación de Gmail en el panel de administración.',
        };
      }

      const nombreDisplay = fullName ? fullName.split(' ')[0] : 'Jugador';

      const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Código de Verificación PiggyBank</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0b1120; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #0b1120; padding: 40px 20px;">
    <tr>
      <td align="center">
        <!-- Contenedor Principal -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background: linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%); border-radius: 28px; border: 1px solid rgba(255, 255, 255, 0.1); overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);">
          
          <!-- Encabezado con Logo y Gradiente -->
          <tr>
            <td align="center" style="padding: 40px 30px 20px 30px; background: linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%); border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="font-size: 52px; line-height: 1; margin-bottom: 12px;">🐷</div>
              <h1 style="margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff;">
                Piggy<span style="color: #facc15;">Bank</span> <span style="font-size: 14px; background: rgba(250, 204, 21, 0.2); color: #facc15; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(250, 204, 21, 0.3); font-weight: 800; vertical-align: middle;">SV</span>
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #94a3b8; font-weight: 500;">
                Salas de Sorteo Comunitarias • El Salvador
              </p>
            </td>
          </tr>

          <!-- Cuerpo del Mensaje -->
          <tr>
            <td style="padding: 35px 35px 25px 35px; text-align: center;">
              <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; color: #f8fafc;">
                ¡Hola, ${nombreDisplay}!
              </h2>
              <p style="margin: 0 0 25px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Gracias por unirte a PiggyBank. Para activar tu cuenta de jugador y asegurar tus participaciones en los sorteos, ingresa este código de verificación:
              </p>

              <!-- Tarjeta del Código OTP -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; background: #020617; border: 2px dashed #f59e0b; border-radius: 18px; padding: 18px 36px; margin: 10px 0 20px 0;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 900; letter-spacing: 10px; color: #fbbf24; text-shadow: 0 0 12px rgba(251, 191, 36, 0.4);">
                        ${code}
                      </span>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 16px 0; font-size: 12px; color: #94a3b8;">
                ⏰ Este código es válido durante los próximos <strong style="color: #f8fafc;">10 minutos</strong>.
              </p>
              <div style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.2); border-radius: 12px; padding: 12px 16px; margin-top: 15px; font-size: 12px; color: #fda4af; text-align: left;">
                🛡️ <strong>Aviso de Seguridad:</strong> El equipo de PiggyBank nunca te pedirá este código ni tus contraseñas por llamada o mensaje.
              </div>
            </td>
          </tr>

          <!-- Pie de Página -->
          <tr>
            <td style="padding: 24px 35px; background: rgba(0, 0, 0, 0.3); border-top: 1px solid rgba(255, 255, 255, 0.05); text-align: center;">
              <p style="margin: 0 0 8px 0; font-size: 11px; color: #64748b;">
                PiggyBank El Salvador • Transacciones protegidas por Visa, Mastercard y 3D Secure
              </p>
              <p style="margin: 0; font-size: 11px; color: #475569;">
                Enviado desde <a href="mailto:${config.smtpUser}" style="color: #94a3b8; text-decoration: none;">${config.smtpUser}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
      `;

      const info = await transporter.sendMail({
        from: `"${config.senderName}" <${config.smtpUser}>`,
        to: toEmail,
        subject: `🐷 Tu código de verificación PiggyBank: ${code}`,
        text: `¡Hola ${nombreDisplay}!\n\nTu código de verificación de PiggyBank es: ${code}\n\nEs válido durante 10 minutos. No compartas este código con nadie.\n\nPiggyBank El Salvador`,
        html: htmlContent,
      });

      console.log(`✅ Correo enviado con éxito a ${toEmail}. MessageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      console.error('❌ Error al enviar correo de verificación:', error);
      return {
        success: false,
        error: error.message || 'Error desconocido al enviar correo vía Gmail SMTP.',
      };
    }
  }

  /**
   * Prueba la conexión SMTP y envía un correo de diagnóstico
   */
  public static async testConnection(
    targetEmail?: string
  ): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      const { config, transporter } = await this.createTransporter();

      if (!config.smtpPass) {
        return {
          success: false,
          message:
            'No hay Contraseña de Aplicación de Gmail configurada. Por favor ingresa el token de 16 caracteres.',
        };
      }

      // 1. Verificar credenciales con el servidor SMTP
      await transporter.verify();

      // 2. Enviar correo de prueba
      const recipient = targetEmail || config.smtpUser;
      const testInfo = await transporter.sendMail({
        from: `"${config.senderName}" <${config.smtpUser}>`,
        to: recipient,
        subject: '🧪 Prueba de Conexión Exitosa - PiggyBank SMTP',
        html: `
          <div style="font-family: sans-serif; background: #0f172a; color: #ffffff; padding: 30px; border-radius: 16px;">
            <h2 style="color: #22c55e;">✅ Conexión SMTP Exitosa</h2>
            <p>La configuración de correo para <strong>${config.smtpUser}</strong> está funcionando perfectamente.</p>
            <p style="font-size: 12px; color: #94a3b8;">Servidor: ${config.smtpHost}:${config.smtpPort} (SSL: ${config.smtpSecure ? 'Sí' : 'No'})</p>
            <p style="font-size: 12px; color: #f59e0b;">PiggyBank El Salvador - Notificaciones en tiempo real</p>
          </div>
        `,
      });

      return {
        success: true,
        message: `Conexión con Gmail SMTP verificada y correo de prueba enviado exitosamente a ${recipient}.`,
        details: { messageId: testInfo.messageId, recipient },
      };
    } catch (error: any) {
      console.error('Error al probar conexión SMTP:', error);
      let errorMsg = error.message || 'Error al conectar con el servidor SMTP.';
      if (errorMsg.includes('Invalid login') || errorMsg.includes('535-5.7.8')) {
        errorMsg =
          'Error de autenticación en Gmail. Verifica que hayas generado una "Contraseña de Aplicación" de 16 caracteres en myaccount.google.com/apppasswords y no tu contraseña personal regular.';
      }
      return {
        success: false,
        message: errorMsg,
      };
    }
  }
}
