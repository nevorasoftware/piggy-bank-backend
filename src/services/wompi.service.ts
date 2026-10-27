import axios from 'axios';
import { prisma } from '../config/database';
import { ENV } from '../config/env';
import { verifyWompiChecksum, WompiWebhookPayload } from '../utils/hmac';
import { puedeParticipar } from '../middlewares/participation.middleware';
import { broadcastRoomUpdate } from '../socket/socket.handler';
import { WhatsAppService } from './whatsapp.service';
import { getElSalvadorDateString } from '../utils/date';
import { RoomStatus, TransactionStatus, TicketStatus } from '@prisma/client';

export class WompiService {
  private static cachedToken: { token: string; expiresAt: number } | null = null;

  /**
   * Obtiene la configuración de Wompi desde la base de datos (con fallback a valores por defecto)
   */
  public static async getPaymentConfig() {
    let config = await prisma.paymentConfig.findFirst({ where: { id: 1 } });
    if (!config) {
      config = await prisma.paymentConfig.create({
        data: {
          id: 1,
          wompiAppId: 'ba6ddd9d-e5d4-4c73-8571-9c3fde2f31e2',
          wompiApiSecret: '4dbf191f-c328-4a98-af50-c85a6722a599',
          wompiAuthUrl: 'https://id.wompi.sv/connect/token',
          wompiApiUrl: 'https://api.wompi.sv',
          isLive: false,
        },
      });
    }
    return config;
  }

  /**
   * Limpia el token cacheado al actualizar credenciales
   */
  public static clearTokenCache() {
    this.cachedToken = null;
  }

  /**
   * Enmascara el secreto para protegerlo en respuestas REST
   */
  public static maskSecret(secret?: string): string {
    if (!secret) return '';
    if (secret.length <= 8) return '••••••••';
    return `${secret.slice(0, 4)}••••••••••••${secret.slice(-4)}`;
  }

  /**
   * Obtiene un token de acceso OAuth 2.0 (Client Credentials) desde Wompi SV
   * Documentación Oficial: https://docs.wompi.sv/autenticacion/autenticacion
   */
  public static async getAccessToken(customConfig?: { appId: string; apiSecret: string; authUrl?: string }) {
    const config = customConfig || (await this.getPaymentConfig());
    const appId = customConfig ? customConfig.appId : (config as any).wompiAppId;
    const apiSecret = customConfig ? customConfig.apiSecret : (config as any).wompiApiSecret;
    const authUrl = customConfig?.authUrl || (config as any).wompiAuthUrl || 'https://id.wompi.sv/connect/token';

    if (!appId || !apiSecret) {
      throw new Error('Credenciales de Wompi SV (App ID y API Secret) no configuradas en el sistema.');
    }

    // Verificar si el token en memoria sigue vigente (con 60s de margen)
    if (!customConfig && this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60000) {
      return this.cachedToken.token;
    }

    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', appId.trim());
      params.append('client_secret', apiSecret.trim());
      params.append('audience', 'wompi_api');

      const response = await axios.post(authUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 12000,
      });

      const { access_token, expires_in } = response.data;
      if (!access_token) {
        throw new Error('Respuesta inesperada de Wompi: No se recibió access_token.');
      }

      if (!customConfig) {
        this.cachedToken = {
          token: access_token,
          expiresAt: Date.now() + (expires_in || 3600) * 1000,
        };
      }

      return access_token;
    } catch (err: any) {
      const errorDetail = err.response?.data?.error_description || err.response?.data?.error || err.message;
      console.error('❌ [Wompi OAuth Error]:', errorDetail);
      throw new Error(`Error al autenticar con Wompi SV: ${errorDetail}`);
    }
  }

  /**
   * Prueba la conectividad y validez de las credenciales de Wompi SV
   */
  public static async testCredentials(appId?: string, apiSecret?: string, authUrl?: string) {
    let targetAppId = appId;
    let targetApiSecret = apiSecret;
    let targetAuthUrl = authUrl;

    if (!targetAppId || !targetApiSecret) {
      const activeConfig = await this.getPaymentConfig();
      targetAppId = targetAppId || activeConfig.wompiAppId;
      targetApiSecret = targetApiSecret || activeConfig.wompiApiSecret;
      targetAuthUrl = targetAuthUrl || activeConfig.wompiAuthUrl;
    }

    const token = await this.getAccessToken({
      appId: targetAppId,
      apiSecret: targetApiSecret,
      authUrl: targetAuthUrl,
    });

    return {
      success: true,
      message: 'Autenticación con Wompi SV exitosa. Token OAuth 2.0 generado correctamente.',
      tokenPreview: token ? `${token.substring(0, 16)}...` : '',
    };
  }

  /**
   * Inicia el proceso de checkout para comprar un boleto en una sala.
   * Realiza la validación previa de las reglas 6/3 antes de generar la sesión en Wompi.
   */
  public static async createPaymentSession(userId: string, roomId: string) {
    // 1. Validar reglas de participación antes de cobrar
    const ruleCheck = await puedeParticipar(userId);
    if (!ruleCheck.allowed) {
      throw new Error(ruleCheck.reason || 'No cumples con las reglas de participación diaria.');
    }

    // 2. Validar estado y disponibilidad de la sala
    const room = await prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new Error('La sala solicitada no existe.');
    }

    if (room.estado !== RoomStatus.ABIERTA) {
      throw new Error(`La sala no se encuentra abierta para compra (Estado actual: ${room.estado}).`);
    }

    if (room.ticketsSold >= room.capacidadMax) {
      throw new Error('La sala ha alcanzado su capacidad máxima de jugadores.');
    }

    // 3. Obtener configuración de Wompi de la base de datos
    const config = await this.getPaymentConfig();

    // 4. Generar referencia única de transacción
    const reference = `PB-${room.id.substring(0, 5).toUpperCase()}-${Date.now()}`;
    const amountInDollars = Number(room.costoPase);
    const amountInCents = Math.round(amountInDollars * 100);

    // 5. Crear registro de transacción pendiente en base de datos
    const transaction = await prisma.transaction.create({
      data: {
        userId,
        roomId: room.id,
        wompiReference: reference,
        amount: amountInDollars,
        currency: 'USD',
        status: TransactionStatus.PENDING,
      },
    });

    const redirectUrl = `${ENV.FRONTEND_URL}/rooms/${room.id}?status=success&ref=${reference}`;

    // 6. Intentar generar enlace de pago en Wompi SV si las credenciales están configuradas
    let wompiPaymentUrl = '';
    try {
      if (config.wompiAppId && config.wompiApiSecret) {
        const token = await this.getAccessToken();
        const wompiApiUrl = config.wompiApiUrl || 'https://api.wompi.sv';

        const paymentLinkRes = await axios.post(
          `${wompiApiUrl}/EnlacePago`,
          {
            identificadorEnlaceComercio: reference,
            monto: amountInDollars,
            nombreProducto: `Pase Digital - ${room.nombre}`,
            formaPago: {
              permitirTarjetaCreditoDebido: true,
            },
            configuracion: {
              urlRedirect: redirectUrl,
              urlWebhook: `${ENV.BACKEND_PUBLIC_URL}/api/webhooks/wompi`,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            timeout: 8000,
          }
        );

        if (paymentLinkRes.data?.urlEnlace) {
          wompiPaymentUrl = paymentLinkRes.data.urlEnlace;
        }
      }
    } catch (err: any) {
      console.warn('⚠️ [Wompi Service] No se pudo generar enlace dinámico remoto, usando flujo integrado:', err.message);
    }

    return {
      transactionId: transaction.id,
      reference,
      amountInDollars,
      amountInCents,
      currency: 'USD',
      appId: config.wompiAppId,
      isLive: config.isLive,
      paymentUrl: wompiPaymentUrl,
      room: {
        id: room.id,
        nombre: room.nombre,
        premio: room.premio,
      },
      redirectUrl,
    };
  }

  /**
   * Procesa el webhook de Wompi con validación HMAC y ejecución estricta del middleware puedeParticipar.
   */
  public static async processWebhook(payload: any, signatureHeader?: string) {
    console.log('🔔 [Wompi Webhook] Recibido evento:', payload?.event || payload?.idTransaccion || 'Wompi SV');

    // 1. Validar firma criptográfica HMAC si aplica
    const isValidSignature = verifyWompiChecksum(payload, signatureHeader);
    if (!isValidSignature) {
      console.error('❌ [Wompi Webhook] Firma HMAC / Checksum inválido.');
      throw new Error('Firma criptográfica inválida.');
    }

    const transactionData = payload.data?.transaction;
    const reference =
      transactionData?.reference ||
      payload.identificadorEnlaceComercio ||
      payload.idExterno ||
      payload.reference;

    if (!reference) {
      console.warn('⚠️ [Wompi Webhook] Payload no contiene referencia válida.');
      return { success: false, message: 'Payload sin referencia de transacción' };
    }

    const wompiTxId = String(
      transactionData?.id || payload.idTransaccion || payload.id || `wompi_${Date.now()}`
    );

    const isApproved =
      transactionData?.status === 'APPROVED' ||
      payload.esAprobada === true ||
      payload.status === 'APPROVED' ||
      payload.resultado === 'Aprobada';

    const payment_method_type =
      transactionData?.payment_method_type || payload.formaPago || 'CARD';

    // 2. Buscar la transacción local registrada
    const localTx = await prisma.transaction.findUnique({
      where: { wompiReference: reference },
      include: {
        user: true,
        room: true,
      },
    });

    if (!localTx) {
      console.error(`❌ [Wompi Webhook] Transacción no encontrada para referencia: ${reference}`);
      return { success: false, message: 'Transacción no encontrada' };
    }

    // Evitar reprocesar si ya fue aprobada (Idempotencia)
    if (localTx.status === TransactionStatus.APPROVED) {
      console.log(`ℹ️ [Wompi Webhook] Transacción ${reference} ya fue aprobada previamente.`);
      return { success: true, message: 'Transacción ya procesada' };
    }

    // Si el pago no fue aprobado por Wompi
    if (!isApproved) {
      await prisma.transaction.update({
        where: { id: localTx.id },
        data: {
          wompiTransactionId: wompiTxId,
          status: TransactionStatus.DECLINED,
          paymentMethod: String(payment_method_type),
        },
      });
      return { success: true, message: 'Transacción marcada como DECLINED' };
    }

    // 3. Ejecutar validación de reglas 6/3 antes de asignar el pase definitivo
    const check = await puedeParticipar(localTx.userId);
    if (!check.allowed) {
      console.warn(`⛔ [Wompi Webhook] Usuario ${localTx.userId} excedió límites diarios al momento del webhook.`);
      await prisma.transaction.update({
        where: { id: localTx.id },
        data: {
          wompiTransactionId: wompiTxId,
          status: TransactionStatus.REJECTED_OVERLIMIT,
          metadata: { reason: check.reason },
        },
      });
      return {
        success: false,
        message: 'Usuario superó el límite de participaciones diarias. Se requiere reembolso.',
      };
    }

    if (!localTx.roomId || !localTx.room) {
      throw new Error('Transacción no tiene sala asociada.');
    }

    return await this.finalizeApprovedTransaction(localTx, wompiTxId, String(payment_method_type || 'CARD'));
  }

  /**
   * Confirma una transacción por su referencia única cuando el usuario retorna de Wompi.
   */
  public static async confirmTransactionByReference(userId: string, reference: string) {
    const localTx = await prisma.transaction.findUnique({
      where: { wompiReference: reference },
      include: {
        user: true,
        room: true,
      },
    });

    if (!localTx) {
      throw new Error(`Transacción no encontrada para la referencia: ${reference}`);
    }

    if (localTx.userId !== userId) {
      throw new Error('Esta transacción pertenece a otro usuario.');
    }

    // Si ya estaba aprobada, devolver el boleto existente
    if (localTx.status === TransactionStatus.APPROVED) {
      const ticket = await prisma.ticket.findFirst({
        where: { transactionId: localTx.id },
        include: { room: true },
      });
      return { success: true, ticket, room: localTx.room, alreadyProcessed: true };
    }

    // Validar reglas 6/3 antes de emitir
    const check = await puedeParticipar(userId);
    if (!check.allowed) {
      throw new Error(check.reason || 'Límite de participaciones alcanzado.');
    }

    // Finalizar transacción aprobada
    const finalResult = await this.finalizeApprovedTransaction(
      localTx,
      localTx.wompiTransactionId || `wompi_redirect_${Date.now()}`,
      'CARD'
    );

    return {
      success: true,
      ticket: finalResult.newTicket,
      room: finalResult.updatedRoom,
    };
  }

  /**
   * Finaliza atómicamente una transacción aprobada (sea por Webhook o API directa),
   * emitiendo el boleto, actualizando estadísticas 6/3, Socket.io y confirmación de WhatsApp.
   */
  public static async finalizeApprovedTransaction(localTx: any, wompiTxId: string, paymentMethod: string) {
    const fechaHoy = getElSalvadorDateString();

    const result = await prisma.$transaction(async (tx) => {
      const freshRoom = await tx.room.findUniqueOrThrow({
        where: { id: localTx.roomId! },
      });

      if (freshRoom.ticketsSold >= freshRoom.capacidadMax) {
        throw new Error('La sala se llenó antes de confirmar este boleto.');
      }

      const nextTicketCount = freshRoom.ticketsSold + 1;
      const roomCode = freshRoom.nombre.substring(0, 3).toUpperCase().replace(/\s/g, 'P');
      const ticketNumber = `TKT-${roomCode}-${String(nextTicketCount).padStart(4, '0')}`;

      // Crear boleto activo
      const newTicket = await tx.ticket.create({
        data: {
          ticketNumber,
          roomId: freshRoom.id,
          userId: localTx.userId,
          transactionId: localTx.id,
          precio: freshRoom.costoPase,
          estado: TicketStatus.ACTIVO,
        },
      });

      // Actualizar contador de sala y estado si se llena
      const newStatus =
        nextTicketCount >= freshRoom.capacidadMax ? RoomStatus.LLENA : freshRoom.estado;

      const updatedRoom = await tx.room.update({
        where: { id: freshRoom.id },
        data: {
          ticketsSold: nextTicketCount,
          estado: newStatus,
        },
      });

      // Incrementar participaciones del usuario hoy
      await tx.dailyUserStats.upsert({
        where: {
          userId_fecha: {
            userId: localTx.userId,
            fecha: fechaHoy,
          },
        },
        update: {
          participaciones: { increment: 1 },
        },
        create: {
          userId: localTx.userId,
          fecha: fechaHoy,
          participaciones: 1,
          victorias: 0,
        },
      });

      // Actualizar transacción a APROBADA
      const updatedTx = await tx.transaction.update({
        where: { id: localTx.id },
        data: {
          wompiTransactionId: wompiTxId,
          status: TransactionStatus.APPROVED,
          paymentMethod,
        },
      });

      return { newTicket, updatedRoom, updatedTx };
    });

    console.log(`🎟️ [Wompi Service] Boleto asignado: ${result.newTicket.ticketNumber} para usuario ${localTx.userId}`);

    // Emitir actualización a Socket.io
    broadcastRoomUpdate(result.updatedRoom.id, {
      roomId: result.updatedRoom.id,
      ticketsSold: result.updatedRoom.ticketsSold,
      capacidadMax: result.updatedRoom.capacidadMax,
      estado: result.updatedRoom.estado,
    });

    // Enviar confirmación por WhatsApp
    if (localTx.user?.phone) {
      const drawTimeFormatted = new Date(result.updatedRoom.horaSorteo).toLocaleTimeString('es-SV', {
        hour: '2-digit',
        minute: '2-digit',
      });
      await WhatsAppService.sendTicketConfirmation(
        localTx.user.phone,
        localTx.user.fullName,
        result.updatedRoom.nombre,
        result.newTicket.ticketNumber,
        drawTimeFormatted
      );
    }

    return {
      success: true,
      newTicket: result.newTicket,
      ticket: result.newTicket,
      updatedRoom: result.updatedRoom,
      roomStatus: result.updatedRoom.estado,
    };
  }

  /**
   * Ejecuta una transacción de compra con tarjeta de crédito/débito utilizando las credenciales
   * parametrizadas en la base de datos de Wompi El Salvador.
   * Documentación Oficial: https://docs.wompi.sv/metodos-api/crear-transaccion-compra
   */
  public static async executePurchaseTransaction(
    userId: string,
    roomId: string,
    cardData?: {
      numeroTarjeta: string;
      cvv: string;
      mesVencimiento: number;
      anioVencimiento: number;
    }
  ) {
    // 1. Validar reglas de participación antes de cobrar
    const ruleCheck = await puedeParticipar(userId);
    if (!ruleCheck.allowed) {
      throw new Error(ruleCheck.reason || 'No cumples con las reglas de participación diaria.');
    }

    // 2. Validar sala
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new Error('La sala solicitada no existe.');
    if (room.estado !== RoomStatus.ABIERTA) {
      throw new Error(`La sala no se encuentra abierta para compras (Estado actual: ${room.estado}).`);
    }
    if (room.ticketsSold >= room.capacidadMax) {
      throw new Error('La sala ha alcanzado su capacidad máxima de participantes.');
    }

    // 3. Obtener usuario
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('Usuario no encontrado.');

    // 4. Obtener configuración Wompi parametrizada en PostgreSQL
    const config = await this.getPaymentConfig();
    const reference = `PB-${room.id.substring(0, 5).toUpperCase()}-${Date.now()}`;
    const amountInDollars = Number(room.costoPase);

    // 5. Crear registro de transacción pendiente
    const localTx = await prisma.transaction.create({
      data: {
        userId,
        roomId: room.id,
        wompiReference: reference,
        amount: amountInDollars,
        currency: 'USD',
        status: TransactionStatus.PENDING,
      },
      include: {
        user: true,
        room: true,
      },
    });

    let isApproved = false;
    let wompiTxId = `wompi_${Date.now()}`;
    let authorizationCode = '';

    // 6. Si se proporcionaron datos de tarjeta y credenciales de Wompi
    if (cardData && config.wompiAppId && config.wompiApiSecret) {
      try {
        const token = await this.getAccessToken();
        const wompiApiUrl = config.wompiApiUrl || 'https://api.wompi.sv';

        const purchaseRes = await axios.post(
          `${wompiApiUrl}/TransaccionCompra`,
          {
            tarjetaCreditoDebido: {
              numeroTarjeta: cardData.numeroTarjeta.replace(/\s|-/g, ''),
              cvv: String(cardData.cvv).trim(),
              mesVencimiento: Number(cardData.mesVencimiento),
              anioVencimiento: Number(cardData.anioVencimiento),
            },
            monto: amountInDollars,
            emailCliente: user.email,
            nombreCliente: user.fullName,
            formaPago: 0,
            idExterno: reference,
            configuracion: {
              urlWebhook: `${ENV.BACKEND_PUBLIC_URL}/api/webhooks/wompi`,
              notificarTransaccionCliente: true,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );

        if (purchaseRes.data?.esAprobada) {
          isApproved = true;
          wompiTxId = purchaseRes.data.idTransaccion || wompiTxId;
          authorizationCode = purchaseRes.data.codigoAutorizacion || '';
        } else {
          await prisma.transaction.update({
            where: { id: localTx.id },
            data: {
              status: TransactionStatus.DECLINED,
              metadata: { message: purchaseRes.data?.mensaje },
            },
          });
          throw new Error(purchaseRes.data?.mensaje || 'Transacción denegada por el banco emisor.');
        }
      } catch (err: any) {
        if (err.response?.data?.mensaje) {
          throw new Error(err.response.data.mensaje);
        }
        // En modo Sandbox / Desarrollo, simulamos aprobación exitosa
        if (!config.isLive) {
          console.log('ℹ️ [Wompi Sandbox] Simulación de aprobación de transacción en ambiente de pruebas.');
          isApproved = true;
        } else {
          throw err;
        }
      }
    } else {
      // Modo sandbox directo
      isApproved = true;
    }

    if (isApproved) {
      const finalResult = await this.finalizeApprovedTransaction(localTx, wompiTxId, 'CARD');
      return {
        success: true,
        reference,
        authorizationCode,
        ticket: finalResult.newTicket,
        roomStatus: finalResult.updatedRoom.estado,
      };
    }

    throw new Error('La transacción no pudo ser autorizada.');
  }
}

