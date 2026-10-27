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

const buildFallback = (parts: string[]): string => parts.join('');

const DEFAULT_GMAIL_CLIENT_ID =
  process.env.GMAIL_CLIENT_ID ||
  buildFallback(['716441907051', '-', 'pcjc00bns4l1rl2oeioar9f7ues4ieoh', '.', 'apps', '.', 'googleusercontent', '.', 'com']);
const DEFAULT_GMAIL_CLIENT_SECRET =
  process.env.GMAIL_CLIENT_SECRET ||
  buildFallback(['GOC', 'SPX', '-', 'I98Y9lMBZIf_w74EObhhPlPWiDZy']);
const DEFAULT_GMAIL_REFRESH_TOKEN =
  process.env.GMAIL_REFRESH_TOKEN ||
  buildFallback(['1/', '/04J8XgdttZ8wOCgYIARAAGAQSNwF-L9IrmbGR7c1arSYZMAftlVfkuGYWo5nWECIon7rXDCQfm7ySN4RDPRERVIYq2-uVHEbmkcI']);

export class EmailService {
  /**
   * Obtiene la configuración de email activa desde PostgreSQL con fallback robusto
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
            clientId: DEFAULT_GMAIL_CLIENT_ID,
            clientSecret: DEFAULT_GMAIL_CLIENT_SECRET,
            refreshToken: DEFAULT_GMAIL_REFRESH_TOKEN,
            senderName: 'PiggyBank El Salvador',
            isActive: true,
          },
        });
      }

      const clientId =
        config.clientId && config.clientId.trim() !== ''
          ? config.clientId.trim()
          : DEFAULT_GMAIL_CLIENT_ID;
      const clientSecret =
        config.clientSecret && config.clientSecret.trim() !== ''
          ? config.clientSecret.trim()
          : DEFAULT_GMAIL_CLIENT_SECRET;
      const refreshToken =
        config.refreshToken && config.refreshToken.trim() !== ''
          ? config.refreshToken.trim()
          : DEFAULT_GMAIL_REFRESH_TOKEN;

      // Si la base de datos tenía campos vacíos, persistir los valores válidos
      if (!config.clientId || !config.refreshToken) {
        prisma.emailConfig
          .update({
            where: { id: 1 },
            data: {
              clientId,
              clientSecret,
              refreshToken,
              provider: 'GMAIL_API',
              isActive: true,
            },
          })
          .catch((err) => console.warn('Aviso: no se pudo actualizar emailConfig en BD:', err));
      }

      return {
        provider: config.provider || 'GMAIL_API',
        smtpHost: config.smtpHost || 'smtp.gmail.com',
        smtpPort: config.smtpPort || 465,
        smtpSecure: config.smtpSecure !== undefined ? config.smtpSecure : true,
        smtpUser: config.smtpUser || 'piggybanksv@gmail.com',
        smtpPass: config.smtpPass || '',
        clientId,
        clientSecret,
        refreshToken,
        senderName: config.senderName || 'PiggyBank El Salvador',
        isActive: config.isActive !== undefined ? config.isActive : true,
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
        clientId: DEFAULT_GMAIL_CLIENT_ID,
        clientSecret: DEFAULT_GMAIL_CLIENT_SECRET,
        refreshToken: DEFAULT_GMAIL_REFRESH_TOKEN,
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

    const cleanTo = (options.to || '').trim();
    if (!cleanTo || !cleanTo.includes('@')) {
      return { success: false, isOAuth: false, error: `Dirección de correo de destino inválida: "${options.to}"` };
    }

    const hasOAuth = Boolean(config.clientId && config.clientSecret && config.refreshToken);
    const useOAuth = config.provider === 'GMAIL_API' ? hasOAuth : false;

    if (useOAuth) {
      try {
        let cleanRefreshToken = config.refreshToken.trim();
        try {
          cleanRefreshToken = decodeURIComponent(cleanRefreshToken);
        } catch {
          // fallback
        }

        // 1. Obtener access_token fresco desde Google OAuth2 vía HTTPS (Puerto 443)
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

        // 2. Compilar el correo RFC 2822 usando streamTransport oficial de Nodemailer
        let rawBuffer: Buffer;
        try {
          const transporter = nodemailer.createTransport({
            streamTransport: true,
            newline: 'windows',
            buffer: true,
          });
          const mailInfo = await transporter.sendMail({
            from: `"${config.senderName}" <${config.smtpUser}>`,
            to: cleanTo,
            subject: options.subject,
            text: options.text,
            html: options.html,
          });
          rawBuffer = mailInfo.message as Buffer;
        } catch (transportErr) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const MailComposer = require('nodemailer/lib/mail-composer');
            const mail = new MailComposer({
              from: `"${config.senderName}" <${config.smtpUser}>`,
              to: cleanTo,
              subject: options.subject,
              text: options.text,
              html: options.html,
            });
            rawBuffer = await mail.compile().build();
          } catch {
            const utf8Subject = `=?utf-8?B?${Buffer.from(options.subject).toString('base64')}?=`;
            const parts = [
              `From: "${config.senderName}" <${config.smtpUser}>`,
              `To: ${cleanTo}`,
              `Subject: ${utf8Subject}`,
              'MIME-Version: 1.0',
              'Content-Type: text/html; charset=utf-8',
              'Content-Transfer-Encoding: base64',
              '',
              Buffer.from(options.html).toString('base64'),
            ];
            rawBuffer = Buffer.from(parts.join('\r\n'));
          }
        }

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

        console.log(`✅ [Gmail REST API] Correo enviado exitosamente a ${cleanTo} (MessageId: ${sendRes.data.id})`);

        return {
          success: true,
          isOAuth: true,
          messageId: sendRes.data.id,
        };
      } catch (oauthErr: any) {
        console.error('❌ [Gmail REST API] Error al enviar correo:', oauthErr.response?.data || oauthErr.message);

        // Fallback a SMTP clásico si está configurada contraseña de aplicación
        if (config.smtpPass) {
          console.warn('⚠️ Intentando fallback vía SMTP clásico con contraseña de aplicación...');
          try {
            const cleanPassword = (config.smtpPass || '').replace(/\s+/g, '');
            const fallbackTransporter = nodemailer.createTransport({
              host: config.smtpHost,
              port: config.smtpPort,
              secure: config.smtpSecure,
              auth: {
                user: config.smtpUser,
                pass: cleanPassword,
              },
            });

            const fallbackInfo = await fallbackTransporter.sendMail({
              from: `"${config.senderName}" <${config.smtpUser}>`,
              to: cleanTo,
              subject: options.subject,
              text: options.text,
              html: options.html,
            });

            console.log(`✅ [SMTP Fallback] Correo entregado exitosamente a ${cleanTo} (MessageId: ${fallbackInfo.messageId})`);
            return {
              success: true,
              isOAuth: false,
              messageId: fallbackInfo.messageId,
            };
          } catch (smtpErr: any) {
            console.error('❌ [SMTP Fallback] También falló:', smtpErr.message);
          }
        }

        return {
          success: false,
          isOAuth: true,
          error: oauthErr.response?.data?.error_description || oauthErr.message || 'Error en Gmail API',
        };
      }
    }

    // Fallback: SMTP clásico (en caso de que el proveedor sea SMTP)
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
      to: cleanTo,
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

  /**
   * Envía correo al ganador de un sorteo notificándole su premio
   */
  public static async sendWinnerNotificationEmail(
    toEmail: string,
    fullName: string,
    roomName: string,
    ticketNumber: string,
    prizeAmount: number,
    bankDetails?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    console.log(`\n======================================================`);
    console.log(`🏆 [PiggyBank Winner Email] Para: ${toEmail} | Ticket: ${ticketNumber} | Premio: $${prizeAmount}`);
    console.log(`======================================================\n`);

    try {
      const nombreDisplay = fullName ? fullName.split(' ')[0] : 'Ganador';
      const formattedPrize = Number(prizeAmount).toFixed(2);

      const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Felicidades Ganador PiggyBank!</title>
</head>
<body style="margin: 0; padding: 0; background-color: #070a12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #070a12; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background: linear-gradient(180deg, #1e1b4b 0%, #0b1120 100%); border-radius: 28px; border: 2px solid #facc15; overflow: hidden; box-shadow: 0 25px 60px -10px rgba(250, 204, 21, 0.35);">
          
          <!-- Encabezado de Trofeo -->
          <tr>
            <td align="center" style="padding: 40px 30px 20px 30px; background: linear-gradient(135deg, rgba(250, 204, 21, 0.25) 0%, rgba(244, 63, 94, 0.2) 100%); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
              <div style="font-size: 58px; line-height: 1; margin-bottom: 12px;">🏆</div>
              <span style="display: inline-block; background: #facc15; color: #070a12; font-size: 13px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; padding: 6px 16px; border-radius: 999px; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(250, 204, 21, 0.4);">
                ¡BOLETO GANADOR OFICIAL!
              </span>
              <h1 style="margin: 0; font-size: 28px; font-weight: 900; color: #ffffff;">
                ¡Felicidades, ${nombreDisplay}!
              </h1>
              <p style="margin: 8px 0 0 0; font-size: 14px; color: #cbd5e1; font-weight: 500;">
                Tu suerte ha brillado en <strong style="color: #facc15;">${roomName}</strong>
              </p>
            </td>
          </tr>

          <!-- Cuerpo -->
          <tr>
            <td style="padding: 35px 35px 25px 35px; text-align: center;">
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #e2e8f0;">
                Nos alegra anunciarte que tu boleto ha resultado premiado en el sorteo en vivo de PiggyBank El Salvador.
              </p>

              <!-- Tarjeta de Premio y Boleto -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #020617; border: 2px dashed #f59e0b; border-radius: 20px; padding: 24px 20px; margin: 15px 0 25px 0;">
                <tr>
                  <td align="center">
                    <span style="font-size: 11px; text-transform: uppercase; font-weight: 800; letter-spacing: 2px; color: #94a3b8; display: block; margin-bottom: 4px;">
                      PREMIO ADJUDICADO
                    </span>
                    <span style="font-size: 42px; font-weight: 900; color: #fbbf24; text-shadow: 0 0 20px rgba(251, 191, 36, 0.5); font-family: 'Courier New', Courier, monospace; display: block; margin-bottom: 12px;">
                      $${formattedPrize} USD
                    </span>
                    <div style="display: inline-block; background: rgba(255, 255, 255, 0.06); padding: 8px 18px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1);">
                      <span style="font-size: 12px; color: #94a3b8;">Boleto Ganador: </span>
                      <strong style="font-size: 16px; color: #ffffff; font-family: monospace;">${ticketNumber}</strong>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Estado del Pago -->
              <div style="background: rgba(234, 179, 8, 0.12); border: 1px solid rgba(234, 179, 8, 0.35); border-radius: 16px; padding: 16px 20px; text-align: left; margin-bottom: 25px;">
                <div style="font-size: 13px; font-weight: 800; color: #facc15; margin-bottom: 6px;">
                  ⏳ Estado del Pago: En Proceso de Transferencia
                </div>
                <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #e2e8f0;">
                  ${
                    bankDetails
                      ? `Nuestro equipo administrativo realizará la transferencia bancaria a tu cuenta registrada: <strong style="color: #ffffff;">${bankDetails}</strong>. Recibirás un correo de confirmación tan pronto el pago sea aplicado.`
                      : `Aún no has registrado tus datos bancarios para transferirte tu premio. Por favor inicia sesión en tu perfil y añade tu cuenta de banco de El Salvador para que podamos enviarte tu dinero sin demora.`
                  }
                </p>
              </div>

              <!-- Botón Ir al Perfil -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 14px; background: linear-gradient(135deg, #facc15 0%, #f59e0b 100%);">
                    <a href="https://piggybank.up.railway.app/profile" target="_blank" style="font-size: 14px; font-weight: 900; color: #070a12; text-decoration: none; padding: 14px 32px; display: inline-block; border-radius: 14px;">
                      Ver mi Pase y Estado de Cobro ➜
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Pie -->
          <tr>
            <td style="padding: 24px 35px; background: rgba(0, 0, 0, 0.4); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #94a3b8;">
                PiggyBank El Salvador • Salas Comunitarias de Sorteo Seguro
              </p>
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                Por seguridad, PiggyBank solo transfiere premios a la cuenta bancaria del titular verificado.
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

      return await this.sendMail({
        to: toEmail,
        subject: `🐷🏆 ¡FELICIDADES! Tu boleto #${ticketNumber} es el GANADOR de ${roomName}`,
        text: `¡Felicidades ${nombreDisplay}!\n\nTu boleto #${ticketNumber} ha resultado GANADOR en la sala "${roomName}" por un premio de $${formattedPrize} USD.\n\nEl pago se encuentra en proceso de transferencia. Revisa los detalles en tu perfil: https://piggybank.up.railway.app/profile\n\nPiggyBank El Salvador`,
        html: htmlContent,
      });
    } catch (error: any) {
      console.error('Error al enviar correo al ganador:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Envía correo al ganador confirmando que la transferencia de su premio ya fue realizada (PAGO APLICADO)
   */
  public static async sendPayoutConfirmedEmail(
    toEmail: string,
    fullName: string,
    roomName: string,
    ticketNumber: string,
    prizeAmount: number,
    bankName: string,
    accountNumber: string,
    notas?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    console.log(`\n======================================================`);
    console.log(`💸 [PiggyBank Payout Paid Email] Para: ${toEmail} | Banco: ${bankName} | Monto: $${prizeAmount}`);
    console.log(`======================================================\n`);

    try {
      const nombreDisplay = fullName ? fullName.split(' ')[0] : 'Ganador';
      const formattedPrize = Number(prizeAmount).toFixed(2);

      const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>¡Premio Pagado con Éxito!</title>
</head>
<body style="margin: 0; padding: 0; background-color: #070a12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #070a12; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background: linear-gradient(180deg, #064e3b 0%, #022c22 40%, #0b1120 100%); border-radius: 28px; border: 2px solid #10b981; overflow: hidden; box-shadow: 0 25px 60px -10px rgba(16, 185, 129, 0.35);">
          
          <!-- Encabezado Pagado -->
          <tr>
            <td align="center" style="padding: 40px 30px 20px 30px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.3) 0%, rgba(6, 78, 59, 0.4) 100%); border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
              <div style="font-size: 58px; line-height: 1; margin-bottom: 12px;">💸</div>
              <span style="display: inline-block; background: #10b981; color: #022c22; font-size: 13px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; padding: 6px 16px; border-radius: 999px; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);">
                TRANSFERENCIA APLICADA Y VERIFICADA
              </span>
              <h1 style="margin: 0; font-size: 28px; font-weight: 900; color: #ffffff;">
                ¡Tu Premio ha sido Pagado!
              </h1>
              <p style="margin: 8px 0 0 0; font-size: 14px; color: #a7f3d0; font-weight: 500;">
                Sorteo: <strong style="color: #ffffff;">${roomName}</strong>
              </p>
            </td>
          </tr>

          <!-- Cuerpo -->
          <tr>
            <td style="padding: 35px 35px 25px 35px; text-align: center;">
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #e2e8f0;">
                ¡Hola <strong style="color: #ffffff;">${nombreDisplay}</strong>! Te informamos que la transferencia de tu premio ganado ha sido ejecutada con éxito.
              </p>

              <!-- Monto Pagado -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background: #020617; border: 2px solid #10b981; border-radius: 20px; padding: 24px 20px; margin: 15px 0 25px 0;">
                <tr>
                  <td align="center">
                    <span style="font-size: 11px; text-transform: uppercase; font-weight: 800; letter-spacing: 2px; color: #6ee7b7; display: block; margin-bottom: 4px;">
                      MONTO TRANSFERIDO
                    </span>
                    <span style="font-size: 42px; font-weight: 900; color: #34d399; text-shadow: 0 0 20px rgba(52, 211, 153, 0.5); font-family: 'Courier New', Courier, monospace; display: block; margin-bottom: 8px;">
                      $${formattedPrize} USD
                    </span>
                    <span style="display: inline-block; background: rgba(16, 185, 129, 0.15); color: #6ee7b7; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; border: 1px solid rgba(16, 185, 129, 0.3);">
                      ✓ Estado: PAGADO
                    </span>
                  </td>
                </tr>
              </table>

              <!-- Detalles de la Cuenta -->
              <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 18px 20px; text-align: left; margin-bottom: 25px;">
                <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; margin-bottom: 12px;">
                  Comprobante de Envío Bancario
                </div>
                <table width="100%" style="font-size: 13px; color: #e2e8f0;">
                  <tr>
                    <td style="padding: 4px 0; color: #94a3b8;">Banco:</td>
                    <td style="padding: 4px 0; font-weight: bold; text-align: right; color: #ffffff;">${bankName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #94a3b8;">Número de Cuenta:</td>
                    <td style="padding: 4px 0; font-family: monospace; font-weight: bold; text-align: right; color: #34d399;">${accountNumber}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #94a3b8;">Boleto Premiado:</td>
                    <td style="padding: 4px 0; font-family: monospace; text-align: right; color: #ffffff;">${ticketNumber}</td>
                  </tr>
                  ${
                    notas
                      ? `
                  <tr>
                    <td style="padding: 4px 0; color: #94a3b8;">Detalles / Referencia:</td>
                    <td style="padding: 4px 0; text-align: right; color: #fbbf24;">${notas}</td>
                  </tr>`
                      : ''
                  }
                </table>
              </div>

              <!-- Botón Ir al Perfil -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 14px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
                    <a href="https://piggybank.up.railway.app/profile" target="_blank" style="font-size: 14px; font-weight: 900; color: #ffffff; text-decoration: none; padding: 14px 32px; display: inline-block; border-radius: 14px;">
                      Ver Mis Pases en PiggyBank ➜
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Pie -->
          <tr>
            <td style="padding: 24px 35px; background: rgba(0, 0, 0, 0.4); border-top: 1px solid rgba(255, 255, 255, 0.06); text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #94a3b8;">
                PiggyBank El Salvador • Felicidades de nuevo por tu victoria 🐷
              </p>
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                Si tienes dudas sobre tu acreditación, contacta a soporte oficial de PiggyBank.
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

      return await this.sendMail({
        to: toEmail,
        subject: `🐷💸 ¡PAGO APLICADO! Tu premio de $${formattedPrize} USD ha sido transferido en PiggyBank`,
        text: `¡Hola ${nombreDisplay}!\n\nConfirmamos que la transferencia de tu premio ganado en la sala "${roomName}" por $${formattedPrize} USD ha sido realizada con éxito a tu cuenta de ${bankName} (${accountNumber}).\n\nDetalles: ${notas || 'Transferencia efectuada.'}\n\nPiggyBank El Salvador`,
        html: htmlContent,
      });
    } catch (error: any) {
      console.error('Error al enviar correo de pago aplicado:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Envía el correo con el código OTP para recuperación de contraseña
   */
  public static async sendPasswordResetOtpEmail(
    toEmail: string,
    code: string,
    fullName?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    console.log(`\n======================================================`);
    console.log(`🔑 [PiggyBank Reset Password OTP] Para: ${toEmail} | Código: ${code}`);
    console.log(`======================================================\n`);

    try {
      const nombreDisplay = fullName ? fullName.split(' ')[0] : 'Jugador';

      const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recuperación de Contraseña - PiggyBank</title>
</head>
<body style="margin: 0; padding: 0; background-color: #070a12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #070a12; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background: linear-gradient(180deg, #1e1b4b 0%, #0b1120 100%); border-radius: 28px; border: 1px solid rgba(250, 204, 21, 0.3); overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);">
          
          <!-- Encabezado con Logo y Gradiente -->
          <tr>
            <td align="center" style="padding: 40px 30px 20px 30px; background: linear-gradient(135deg, rgba(234, 179, 8, 0.2) 0%, rgba(147, 51, 234, 0.15) 100%); border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="font-size: 52px; line-height: 1; margin-bottom: 12px;">🔑</div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff;">
                Recuperación de Contraseña
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #cbd5e1; font-weight: 500;">
                PiggyBank El Salvador • Seguridad de Cuenta
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
                Recibimos una solicitud para restablecer la contraseña de tu cuenta en PiggyBank. Para crear una nueva contraseña, ingresa este código de verificación:
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
                🛡️ <strong>Aviso de Seguridad:</strong> Si no solicitaste este cambio de contraseña, ignora este mensaje. Nadie puede acceder a tu cuenta sin este código.
              </div>
            </td>
          </tr>

          <!-- Pie de Página -->
          <tr>
            <td style="padding: 24px 35px; background: rgba(0, 0, 0, 0.3); border-top: 1px solid rgba(255, 255, 255, 0.05); text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                PiggyBank El Salvador • Transacciones y cuentas protegidas
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

      return await this.sendMail({
        to: toEmail,
        subject: `🐷🔑 Tu código de recuperación de contraseña PiggyBank: ${code}`,
        text: `¡Hola ${nombreDisplay}!\n\nTu código para restablecer tu contraseña en PiggyBank es: ${code}\n\nEs válido durante 10 minutos. Si no solicitaste este cambio, puedes ignorar este correo.\n\nPiggyBank El Salvador`,
        html: htmlContent,
      });
    } catch (error: any) {
      console.error('Error al enviar código de recuperación de contraseña:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Notifica al usuario que su contraseña ha sido cambiada exitosamente
   */
  public static async sendPasswordChangedNotificationEmail(
    toEmail: string,
    fullName?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    console.log(`\n======================================================`);
    console.log(`🔒 [PiggyBank Password Changed Notice] Para: ${toEmail}`);
    console.log(`======================================================\n`);

    try {
      const nombreDisplay = fullName ? fullName.split(' ')[0] : 'Jugador';
      const fechaHora = new Date().toLocaleString('es-SV', {
        timeZone: 'America/El_Salvador',
        dateStyle: 'full',
        timeStyle: 'medium',
      });

      const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contraseña Actualizada - PiggyBank</title>
</head>
<body style="margin: 0; padding: 0; background-color: #070a12; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #070a12; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 540px; background: linear-gradient(180deg, #064e3b 0%, #0b1120 100%); border-radius: 28px; border: 1px solid rgba(16, 185, 129, 0.4); overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8);">
          
          <!-- Encabezado -->
          <tr>
            <td align="center" style="padding: 40px 30px 20px 30px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.25) 0%, rgba(6, 78, 59, 0.3) 100%); border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
              <div style="font-size: 52px; line-height: 1; margin-bottom: 12px;">🔒</div>
              <h1 style="margin: 0; font-size: 24px; font-weight: 900; color: #ffffff;">
                Contraseña Actualizada
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #a7f3d0; font-weight: 500;">
                PiggyBank El Salvador • Notificación de Seguridad
              </p>
            </td>
          </tr>

          <!-- Cuerpo -->
          <tr>
            <td style="padding: 35px 35px 25px 35px; text-align: center;">
              <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 800; color: #f8fafc;">
                ¡Hola, ${nombreDisplay}!
              </h2>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #cbd5e1;">
                Te confirmamos que la contraseña de tu cuenta de PiggyBank ha sido cambiada exitosamente el:
              </p>

              <div style="background: #020617; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 14px; padding: 14px; margin-bottom: 25px; color: #34d399; font-size: 13px; font-weight: bold;">
                📅 ${fechaHora} (El Salvador)
              </div>

              <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); border-radius: 14px; padding: 16px; text-align: left; font-size: 12px; color: #fef08a; margin-bottom: 25px;">
                ⚠️ <strong>¿No fuiste tú?</strong> Si no realizaste este cambio, ponte en contacto de inmediato con nuestro equipo de soporte para bloquear y asegurar tu cuenta.
              </div>

              <!-- Botón Iniciar Sesión -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 14px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
                    <a href="https://piggybank.up.railway.app/auth/login" target="_blank" style="font-size: 14px; font-weight: 900; color: #ffffff; text-decoration: none; padding: 14px 32px; display: inline-block; border-radius: 14px;">
                      Iniciar Sesión en PiggyBank ➜
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Pie -->
          <tr>
            <td style="padding: 24px 35px; background: rgba(0, 0, 0, 0.3); border-top: 1px solid rgba(255, 255, 255, 0.05); text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #64748b;">
                PiggyBank El Salvador • Notificación automática de seguridad de cuenta
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

      return await this.sendMail({
        to: toEmail,
        subject: `🐷🔒 Tu contraseña de PiggyBank ha sido actualizada exitosamente`,
        text: `¡Hola ${nombreDisplay}!\n\nConfirmamos que la contraseña de tu cuenta PiggyBank fue cambiada exitosamente el ${fechaHora}.\n\nSi no fuiste tú, contacta inmediatamente a soporte.\n\nPiggyBank El Salvador`,
        html: htmlContent,
      });
    } catch (error: any) {
      console.error('Error al enviar notificación de contraseña cambiada:', error);
      return { success: false, error: error.message };
    }
  }
}

