import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { SorteoService } from '../services/sorteo.service';
import { getElSalvadorDateString } from '../utils/date';
import { RoomStatus, TransactionStatus } from '@prisma/client';
import { broadcastRoomUpdate } from '../socket/socket.handler';
import { WompiService } from '../services/wompi.service';
import { EmailService } from '../services/email.service';

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
   * La duración en horas es parametrizable y determina dinámicamente la hora del sorteo.
   */
  public static async createRoom(req: Request, res: Response): Promise<void> {
    try {
      const {
        nombre,
        premio,
        costoPase,
        capacidadMax,
        duracionHoras,
        horaApertura,
        horaSorteo,
        estado,
      } = req.body;

      if (!nombre || premio === undefined || costoPase === undefined || !capacidadMax) {
        res.status(400).json({
          success: false,
          message: 'Nombre, premio, costo del pase y capacidad máxima son obligatorios.',
        });
        return;
      }

      const duracion = duracionHoras ? parseInt(duracionHoras, 10) : 2;
      const now = new Date();

      // Si no se provee horaApertura estática, se toma el momento actual
      const apertura = horaApertura ? new Date(horaApertura) : now;

      // Si no se provee horaSorteo estática, se calcula sumando la duración en horas parametrizada
      const sorteo = horaSorteo
        ? new Date(horaSorteo)
        : new Date(apertura.getTime() + duracion * 3600 * 1000);

      const roomEstado = estado ? (estado as RoomStatus) : RoomStatus.ABIERTA;

      const room = await prisma.room.create({
        data: {
          nombre,
          premio: Number(premio),
          costoPase: Number(costoPase),
          capacidadMax: parseInt(capacidadMax, 10),
          duracionHoras: duracion,
          horaApertura: apertura,
          horaSorteo: sorteo,
          estado: roomEstado,
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
   * Iniciar / Activar Sala en Tiempo Real:
   * Abre la sala y calcula la hora del sorteo sumándole las horas parametrizadas al momento exacto actual.
   */
  public static async startRoom(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { duracionHoras } = req.body;

      const room = await prisma.room.findUnique({ where: { id } });
      if (!room) {
        res.status(404).json({ success: false, message: 'Sala no encontrada.' });
        return;
      }

      if (room.estado === RoomStatus.FINALIZADA) {
        res.status(400).json({ success: false, message: 'No se puede iniciar una sala que ya fue finalizada.' });
        return;
      }

      const now = new Date();
      const duracion = duracionHoras ? parseInt(duracionHoras, 10) : (room.duracionHoras || 2);
      const nuevaHoraSorteo = new Date(now.getTime() + duracion * 3600 * 1000);

      const updated = await prisma.room.update({
        where: { id },
        data: {
          estado: RoomStatus.ABIERTA,
          duracionHoras: duracion,
          horaApertura: now,
          horaSorteo: nuevaHoraSorteo,
        },
      });

      broadcastRoomUpdate(updated.id, { room: updated, action: 'started' });

      res.json({
        success: true,
        message: `¡Sala iniciada con éxito! Sorteo programado en ${duracion} hora(s) a las ${nuevaHoraSorteo.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}.`,
        room: updated,
      });
    } catch (error) {
      console.error('Error en startRoom:', error);
      res.status(500).json({ success: false, message: 'Error al iniciar la sala.' });
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
        duracionHoras,
        horaApertura,
        horaSorteo,
        estado,
      } = req.body;

      const duracion = duracionHoras !== undefined ? parseInt(duracionHoras, 10) : undefined;
      let nuevaHoraSorteo = horaSorteo ? new Date(horaSorteo) : undefined;

      // Si se actualiza duracionHoras y no se mandó horaSorteo manual
      if (duracion !== undefined && !horaSorteo && horaApertura) {
        nuevaHoraSorteo = new Date(new Date(horaApertura).getTime() + duracion * 3600 * 1000);
      }

      const updated = await prisma.room.update({
        where: { id },
        data: {
          nombre,
          premio: premio !== undefined ? Number(premio) : undefined,
          costoPase: costoPase !== undefined ? Number(costoPase) : undefined,
          capacidadMax: capacidadMax !== undefined ? parseInt(capacidadMax, 10) : undefined,
          duracionHoras: duracion,
          horaApertura: horaApertura ? new Date(horaApertura) : undefined,
          horaSorteo: nuevaHoraSorteo,
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
      const adminEmail = (req as any).user?.email;

      const sorteo = await SorteoService.marcarPagoAplicado(id, notas, adminEmail);

      res.json({
        success: true,
        message: 'Pago marcado como APLICADO exitosamente. Ganador y Administración notificados por Correo Electrónico.',
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

  /**
   * Reenviar Correo de Confirmación de Pago para un sorteo
   */
  public static async resendPayoutEmail(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const adminEmail = (req as any).user?.email;

      const result = await SorteoService.enviarNotificacionPago(id, adminEmail);

      res.json({
        success: true,
        message: `Correo de confirmación de pago reenviado exitosamente a ${result.winnerEmail || 'el ganador'} y administración.`,
        result,
      });
    } catch (error: any) {
      console.error('Error en resendPayoutEmail:', error.message);
      res.status(400).json({
        success: false,
        message: error.message || 'Error al reenviar correo de confirmación de pago.',
      });
    }
  }

  /**
   * Configuración de Pasarela Wompi: Obtener parámetros parametrizados en base de datos.
   * Por seguridad del API Rest, el secreto se devuelve enmascarado por defecto.
   */
  public static async getPaymentConfig(req: Request, res: Response): Promise<void> {
    try {
      const config = await WompiService.getPaymentConfig();
      const reveal = req.query.reveal === 'true';

      res.json({
        success: true,
        config: {
          id: config.id,
          wompiAppId: config.wompiAppId,
          wompiAuthUrl: config.wompiAuthUrl,
          wompiApiUrl: config.wompiApiUrl,
          isLive: config.isLive,
          hasSecret: Boolean(config.wompiApiSecret),
          maskedSecret: WompiService.maskSecret(config.wompiApiSecret),
          wompiApiSecret: reveal ? config.wompiApiSecret : undefined,
          updatedAt: config.updatedAt,
        },
      });
    } catch (error) {
      console.error('Error en getPaymentConfig:', error);
      res.status(500).json({ success: false, message: 'Error al obtener la configuración de Wompi.' });
    }
  }

  /**
   * Configuración de Pasarela Wompi: Guardar o actualizar parámetros en base de datos.
   * Maneja de manera segura el secreto: si viene vacío o contiene la máscara '••••', se mantiene el secreto actual.
   */
  public static async updatePaymentConfig(req: Request, res: Response): Promise<void> {
    try {
      const { wompiAppId, wompiApiSecret, wompiAuthUrl, wompiApiUrl, isLive } = req.body;

      if (!wompiAppId || typeof wompiAppId !== 'string') {
        res.status(400).json({
          success: false,
          message: 'El App ID de Wompi es requerido.',
        });
        return;
      }

      // Obtener registro actual
      const currentConfig = await WompiService.getPaymentConfig();

      // Determinar si se actualiza el secreto
      let newSecret = currentConfig.wompiApiSecret;
      if (wompiApiSecret && typeof wompiApiSecret === 'string' && !wompiApiSecret.includes('••••')) {
        newSecret = wompiApiSecret.trim();
      }

      const updated = await prisma.paymentConfig.upsert({
        where: { id: 1 },
        update: {
          wompiAppId: wompiAppId.trim(),
          wompiApiSecret: newSecret,
          wompiAuthUrl: wompiAuthUrl ? wompiAuthUrl.trim() : 'https://id.wompi.sv/connect/token',
          wompiApiUrl: wompiApiUrl ? wompiApiUrl.trim() : 'https://api.wompi.sv',
          isLive: Boolean(isLive),
        },
        create: {
          id: 1,
          wompiAppId: wompiAppId.trim(),
          wompiApiSecret: newSecret,
          wompiAuthUrl: wompiAuthUrl ? wompiAuthUrl.trim() : 'https://id.wompi.sv/connect/token',
          wompiApiUrl: wompiApiUrl ? wompiApiUrl.trim() : 'https://api.wompi.sv',
          isLive: Boolean(isLive),
        },
      });

      // Limpiar caché de token OAuth para que tome las nuevas credenciales de inmediato
      WompiService.clearTokenCache();

      res.json({
        success: true,
        message: 'Configuración de Wompi SV guardada exitosamente en la base de datos.',
        config: {
          id: updated.id,
          wompiAppId: updated.wompiAppId,
          wompiAuthUrl: updated.wompiAuthUrl,
          wompiApiUrl: updated.wompiApiUrl,
          isLive: updated.isLive,
          hasSecret: Boolean(updated.wompiApiSecret),
          maskedSecret: WompiService.maskSecret(updated.wompiApiSecret),
          updatedAt: updated.updatedAt,
        },
      });
    } catch (error) {
      console.error('Error en updatePaymentConfig:', error);
      res.status(500).json({ success: false, message: 'Error al actualizar configuración de Wompi.' });
    }
  }

  /**
   * Prueba en tiempo real la conexión con el servidor OAuth de Wompi SV
   */
  public static async testWompiConnection(req: Request, res: Response): Promise<void> {
    try {
      const { wompiAppId, wompiApiSecret, wompiAuthUrl } = req.body;
      const result = await WompiService.testCredentials(
        wompiAppId,
        wompiApiSecret && !wompiApiSecret.includes('••••') ? wompiApiSecret : undefined,
        wompiAuthUrl
      );

      res.json(result);
    } catch (error: any) {
      console.error('Error al probar conexión con Wompi:', error.message);
      res.status(400).json({
        success: false,
        message: error.message || 'Error al conectar con los servidores de Wompi SV.',
      });
    }
  }

  /**
   * Configuración de Correo Electrónico (Gmail API / SMTP): Obtener parámetros
   */
  public static async getEmailConfig(req: Request, res: Response): Promise<void> {
    try {
      const config = await EmailService.getEmailConfig();
      const reveal = req.query.reveal === 'true';

      const mask = (val: string) => {
        if (!val) return '';
        if (val.length <= 4) return '••••';
        return '••••••••••••' + val.slice(-4);
      };

      res.json({
        success: true,
        config: {
          provider: config.provider,
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          smtpSecure: config.smtpSecure,
          smtpUser: config.smtpUser,
          senderName: config.senderName,
          isActive: config.isActive,
          // Google Cloud Console OAuth2 fields:
          clientId: config.clientId,
          hasClientSecret: Boolean(config.clientSecret),
          maskedClientSecret: mask(config.clientSecret),
          clientSecret: reveal ? config.clientSecret : undefined,
          hasRefreshToken: Boolean(config.refreshToken),
          maskedRefreshToken: mask(config.refreshToken),
          refreshToken: reveal ? config.refreshToken : undefined,
          // SMTP App Password fallback:
          hasPass: Boolean(config.smtpPass),
          maskedPass: mask(config.smtpPass),
          smtpPass: reveal ? config.smtpPass : undefined,
        },
      });
    } catch (error) {
      console.error('Error en getEmailConfig:', error);
      res.status(500).json({ success: false, message: 'Error al obtener configuración de correo.' });
    }
  }

  /**
   * Configuración de Correo Electrónico: Guardar o actualizar parámetros
   */
  public static async updateEmailConfig(req: Request, res: Response): Promise<void> {
    try {
      const {
        provider,
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUser,
        smtpPass,
        clientId,
        clientSecret,
        refreshToken,
        senderName,
        isActive,
      } = req.body;

      if (!smtpUser) {
        res.status(400).json({ success: false, message: 'El correo remitente es requerido.' });
        return;
      }

      const current = await EmailService.getEmailConfig();

      let newPass = current.smtpPass;
      if (smtpPass && typeof smtpPass === 'string' && !smtpPass.includes('••••')) {
        newPass = smtpPass.trim();
      }

      let newClientSecret = current.clientSecret;
      if (clientSecret && typeof clientSecret === 'string' && !clientSecret.includes('••••')) {
        newClientSecret = clientSecret.trim();
      }

      let newRefreshToken = current.refreshToken;
      if (refreshToken && typeof refreshToken === 'string' && !refreshToken.includes('••••')) {
        newRefreshToken = refreshToken.trim();
      }

      const updated = await prisma.emailConfig.upsert({
        where: { id: 1 },
        update: {
          provider: provider ? provider.trim() : 'GMAIL_API',
          smtpHost: smtpHost ? smtpHost.trim() : 'smtp.gmail.com',
          smtpPort: smtpPort ? parseInt(smtpPort, 10) : 465,
          smtpSecure: smtpSecure !== undefined ? Boolean(smtpSecure) : true,
          smtpUser: smtpUser.trim(),
          smtpPass: newPass,
          clientId: clientId !== undefined ? clientId.trim() : current.clientId,
          clientSecret: newClientSecret,
          refreshToken: newRefreshToken,
          senderName: senderName ? senderName.trim() : 'PiggyBank El Salvador',
          isActive: isActive !== undefined ? Boolean(isActive) : true,
        },
        create: {
          id: 1,
          provider: provider ? provider.trim() : 'GMAIL_API',
          smtpHost: smtpHost ? smtpHost.trim() : 'smtp.gmail.com',
          smtpPort: smtpPort ? parseInt(smtpPort, 10) : 465,
          smtpSecure: smtpSecure !== undefined ? Boolean(smtpSecure) : true,
          smtpUser: smtpUser.trim(),
          smtpPass: newPass,
          clientId: clientId !== undefined ? clientId.trim() : '',
          clientSecret: newClientSecret,
          refreshToken: newRefreshToken,
          senderName: senderName ? senderName.trim() : 'PiggyBank El Salvador',
          isActive: isActive !== undefined ? Boolean(isActive) : true,
        },
      });

      res.json({
        success: true,
        message: 'Configuración de Gmail API guardada exitosamente en la base de datos.',
        config: {
          provider: updated.provider,
          smtpHost: updated.smtpHost,
          smtpPort: updated.smtpPort,
          smtpSecure: updated.smtpSecure,
          smtpUser: updated.smtpUser,
          senderName: updated.senderName,
          isActive: updated.isActive,
          clientId: updated.clientId,
          hasClientSecret: Boolean(updated.clientSecret),
          hasRefreshToken: Boolean(updated.refreshToken),
          hasPass: Boolean(updated.smtpPass),
        },
      });
    } catch (error) {
      console.error('Error en updateEmailConfig:', error);
      res.status(500).json({ success: false, message: 'Error al actualizar configuración de correo.' });
    }
  }

  /**
   * Obtener URL de autorización de Google OAuth2
   */
  public static async getGoogleOAuthUrl(req: Request, res: Response): Promise<void> {
    try {
      const config = await EmailService.getEmailConfig();
      const redirectUri =
        (req.query.redirectUri as string) ||
        `${req.protocol}://${req.get('host')}/api/admin/email-config/oauth/callback`;

      if (!config.clientId) {
        res.status(400).json({
          success: false,
          message: 'Primero debes ingresar y guardar el Client ID de Google Cloud Console.',
        });
        return;
      }

      const url = EmailService.getOAuthAuthorizationUrl(config.clientId, redirectUri);
      res.json({ success: true, url, redirectUri });
    } catch (error: any) {
      console.error('Error en getGoogleOAuthUrl:', error);
      res.status(500).json({ success: false, message: error.message || 'Error al generar URL OAuth.' });
    }
  }

  /**
   * Intercambiar código de Google por Refresh Token
   */
  public static async exchangeGoogleOAuthCode(req: Request, res: Response): Promise<void> {
    try {
      const { code, redirectUri } = req.body;
      const config = await EmailService.getEmailConfig();

      if (!code) {
        res.status(400).json({ success: false, message: 'El código de autorización es requerido.' });
        return;
      }

      if (!config.clientId || !config.clientSecret) {
        res.status(400).json({ success: false, message: 'Falta configurar Client ID o Client Secret.' });
        return;
      }

      const defaultRedirectUri = redirectUri || 'https://developers.google.com/oauthplayground';
      const tokens = await EmailService.exchangeCodeForTokens(
        code,
        config.clientId,
        config.clientSecret,
        defaultRedirectUri
      );

      if (!tokens.refreshToken) {
        res.status(400).json({
          success: false,
          message: 'Google no devolvió un refresh_token. Asegúrate de incluir prompt=consent en la autorización.',
        });
        return;
      }

      await prisma.emailConfig.update({
        where: { id: 1 },
        data: {
          refreshToken: tokens.refreshToken,
        },
      });

      res.json({
        success: true,
        message: '¡Refresh Token de Google Cloud obtenido y guardado exitosamente!',
      });
    } catch (error: any) {
      console.error('Error en exchangeGoogleOAuthCode:', error);
      res.status(400).json({
        success: false,
        message: error.response?.data?.error_description || error.message || 'Error al canjear código por tokens.',
      });
    }
  }

  /**
   * Probar conexión y enviar correo de diagnóstico
   */
  public static async testEmailConnection(req: Request, res: Response): Promise<void> {
    try {
      const { testEmail } = req.body;
      const result = await EmailService.testConnection(testEmail);
      res.json(result);
    } catch (error: any) {
      console.error('Error en testEmailConnection:', error);
      res.status(400).json({ success: false, message: error.message || 'Error al probar conexión SMTP.' });
    }
  }
}

