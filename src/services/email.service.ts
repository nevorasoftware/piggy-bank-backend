import nodemailer from 'nodemailer';
import axios from 'axios';
import { prisma } from '../config/database';

export interface EmailConfigData {
  provider: string; // 'GMAIL_API' | 'SMTP'
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
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
            provider: 'GMAIL_API',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 465,
            smtpSecure: true,
            smtpUser: 'piggybanksv@gmail.com',
            smtpPass: '',
            clientId: '',
            clientSecret: '',
            refreshToken: '',
            senderName: 'PiggyBank El Salvador',
            isActive: true,
          },
        });
      }

      return {
        provider: config.provider || 'GMAIL_API',
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        smtpSecure: config.smtpSecure,
        smtpUser: config.smtpUser,
        smtpPass: config.smtpPass,
        clientId: config.clientId || '',
        clientSecret: config.clientSecret || '',
        refreshToken: config.refreshToken || '',
        senderName: config.senderName,
        isActive: config.isActive,
      };
    } catch (error) {
      console.error('Error al obtener EmailConfig de la BD, usando valores por defecto:', error);
      return {
        provider: 'GMAIL_API',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: 'piggybanksv@gmail.com',
        smtpPass: '',
        clientId: '',
        clientSecret: '',
        refreshToken: '',
        senderName: 'PiggyBank El Salvador',
        isActive: true,
      };
    }
  }

  /**
   * Genera la URL de autorización para el consentimiento de Google Cloud Console (OAuth2)
   */
  public static getOAuthAuthorizationUrl(clientId: string, redirectUri: string): string {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const params = new URLSearchParams({
      client_id: clientId.trim(),
      redirect_uri: redirectUri.trim(),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: 'https://mail.google.com/ https://www.googleapis.com/auth/gmail.send',
    });
    return `${rootUrl}?${params.toString()}`;
  }

  /**
   * Intercambia el código de autorización por tokens con Google OAuth2
   */
  public static async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await axios.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code: code.trim(),
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        redirect_uri: redirectUri.trim(),
        grant_type: 'authorization_code',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
    };
  }

  /**
   * Envía un correo ya sea usando la API REST oficial de Gmail (HTTPS) o SMTP clásico
   */
  public static async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ success: boolean; messageId?: string; isOAuth: boolean; error?: string }> {
    const config = await this.getEmailConfig();

    if (!config.isActive) {
      return { success: false, isOAuth: false, error: 'Servicio de email desactivado en la configuración.' };
    }

    const hasOAuth = Boolean(config.clientId && config.clientSecret && config.refreshToken);
    const useOAuth = config.provider === 'GMAIL_API' ? hasOAuth : false;

    if (useOAuth) {
      let cleanRefreshToken = config.refreshToken.trim();
      try {
        cleanRefreshToken = decodeURIComponent(cleanRefreshToken);
      } catch {
        // fallback
      }

      // 1. Obtener access_token fresco desde Google OAuth2 vía HTTPS (Puerto 443 - Nunca bloqueado por Railway/Cloud)
      const tokenRes = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          client_id: config.clientId.trim(),
          client_secret: config.clientSecret.trim(),
          refresh_token: cleanRefreshToken,
          grant_type: 'refresh_token',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }
      );

      const accessToken = tokenRes.data.access_token;
      if (!accessToken) {
        throw new Error('Google no devolvió un access_token válido.');
      }

      // 2. Compilar el correo RFC 2822
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const MailComposer = require('nodemailer/lib/mail-composer');
      const mail = new MailComposer({
        from: `"${config.senderName}" <${config.smtpUser}>`,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      const rawBuffer: Buffer = await mail.compile().build();
      const raw = rawBuffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // 3. Enviar vía Gmail REST API (HTTPS puerto 443)
      const sendRes = await axios.post(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        { raw },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      return {
        success: true,
        isOAuth: true,
        messageId: sendRes.data.id,
      };
    }

    // Fallback: SMTP clásico (en caso de que se configure un servidor SMTP propio)
    if (!config.smtpPass) {
      return { success: false, isOAuth: false, error: 'Falta configurar la contraseña de aplicación de Gmail.' };
    }

    const cleanPassword = (config.smtpPass || '').replace(/\s+/g, '');
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: cleanPassword,
      },
    });

    const info = await transporter.sendMail({
      from: `"${config.senderName}" <${config.smtpUser}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    return {
      success: true,
      isOAuth: false,
      messageId: info.messageId,
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
      const config = await this.getEmailConfig();

      if (!config.isActive) {
        console.warn('⚠️ El servicio de email está desactivado en la configuración.');
        return { success: false, error: 'Servicio de email desactivado.' };
      }

      if (config.provider === 'GMAIL_API' && (!config.clientId || !config.refreshToken)) {
        console.warn('⚠️ Falta configurar Client ID / Refresh Token de Gmail API en el panel admin.');
        return {
          success: false,
          error: 'Falta parametrizar el Client ID y Refresh Token de Gmail API en el panel de administración.',
        };
      }

      if (config.provider === 'SMTP' && !config.smtpPass) {
        console.warn('⚠️ No se ha configurado la contraseña de aplicación de Gmail.');
        return {
          success: false,
          error: 'Falta configurar la contraseña de aplicación de Gmail en el panel admin.',
        };
      }

      const nombreDisplay = fullName ? fullName.split(' ')[0] : 'Jugador';
      const isOAuth = config.provider === 'GMAIL_API';

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
                Enviado vía ${isOAuth ? 'Gmail REST API OAuth2' : 'SMTP'} desde <a href="mailto:${config.smtpUser}" style="color: #94a3b8; text-decoration: none;">${config.smtpUser}</a>
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

      const result = await this.sendMail({
        to: toEmail,
        subject: `🐷 Tu código de verificación PiggyBank: ${code}`,
        text: `¡Hola ${nombreDisplay}!\n\nTu código de verificación de PiggyBank es: ${code}\n\nEs válido durante 10 minutos. No compartas este código con nadie.\n\nPiggyBank El Salvador`,
        html: htmlContent,
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      console.log(`✅ Correo enviado con éxito a ${toEmail}. MessageId: ${result.messageId}`);
      return { success: true, messageId: result.messageId };
    } catch (error: any) {
      console.error('❌ Error al enviar correo de verificación:', error);
      let errorMsg = error.message || 'Error al enviar correo vía Google Gmail API.';
      if (error.response?.data?.error?.message) {
        errorMsg = error.response.data.error.message;
      }
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * Prueba la conexión y envía un correo de diagnóstico
   */
  public static async testConnection(
    targetEmail?: string
  ): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      const config = await this.getEmailConfig();
      const hasOAuth = Boolean(config.clientId && config.clientSecret && config.refreshToken);
      const useOAuth = config.provider === 'GMAIL_API' ? hasOAuth : false;

      if (config.provider === 'GMAIL_API' && (!config.clientId || !config.refreshToken)) {
        return {
          success: false,
          message:
            'Falta configurar el Client ID y el Refresh Token de la consola de Google (Gmail API). Por favor completa esos campos.',
        };
      }

      if (config.provider === 'SMTP' && !config.smtpPass) {
        return {
          success: false,
          message:
            'Falta configurar la Contraseña de Aplicación de Gmail. Por favor ingresa el token de 16 caracteres.',
        };
      }

      const recipient = targetEmail || config.smtpUser;

      const testResult = await this.sendMail({
        to: recipient,
        subject: '🧪 Prueba de Conexión Exitosa - PiggyBank Gmail API',
        html: `
          <div style="font-family: sans-serif; background: #0f172a; color: #ffffff; padding: 30px; border-radius: 16px;">
            <h2 style="color: #22c55e;">✅ Conexión con Gmail API Exitosa</h2>
            <p>La autenticación con Google Cloud Console para <strong>${config.smtpUser}</strong> está funcionando perfectamente.</p>
            <p style="font-size: 13px; color: #94a3b8;">Método: ${useOAuth ? 'Google Cloud OAuth2 (Gmail REST API vía HTTPS)' : 'SMTP App Password'}</p>
            <p style="font-size: 13px; color: #f59e0b;">PiggyBank El Salvador - Notificaciones en tiempo real 🐷</p>
          </div>
        `,
        text: `¡Conexión con Gmail API exitosa para ${config.smtpUser}! Método: ${useOAuth ? 'Gmail REST API (HTTPS)' : 'SMTP'}.`,
      });

      if (!testResult.success) {
        throw new Error(testResult.error || 'Error al enviar por Gmail API.');
      }

      return {
        success: true,
        message: `Conexión con Google Gmail REST API (${testResult.isOAuth ? 'OAuth2 vía HTTPS' : 'SMTP'}) verificada y correo de prueba enviado exitosamente a ${recipient}.`,
        details: { messageId: testResult.messageId, recipient, method: testResult.isOAuth ? 'OAuth2 (REST API)' : 'SMTP' },
      };
    } catch (error: any) {
      console.error('Error al probar conexión con Gmail API:', error);
      let errorMsg = error.message || 'Error al conectar con Google Gmail API.';

      if (error.response?.data?.error_description) {
        errorMsg = `Google OAuth: ${error.response.data.error_description}`;
      } else if (error.response?.data?.error?.message) {
        errorMsg = `Gmail API: ${error.response.data.error.message}`;
      } else if (errorMsg.includes('invalid_grant')) {
        errorMsg =
          'Google rechazó el Refresh Token (invalid_grant). El token expiró o fue revocado. Vuelve a autorizar la app en Google Cloud Console.';
      } else if (errorMsg.includes('invalid_client')) {
        errorMsg =
          'Client ID o Client Secret incorrectos de Google Cloud Console (invalid_client). Verifica que coincidan exactamente con tu proyecto de Google Cloud.';
      }

      return {
        success: false,
        message: errorMsg,
      };
    }
  }
}
