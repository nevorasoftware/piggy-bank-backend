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

    // 3. Generar referencia única de Wompi
    const reference = `PB-${room.id.substring(0, 5).toUpperCase()}-${Date.now()}`;
    const amountInDollars = Number(room.costoPase);
    const amountInCents = Math.round(amountInDollars * 100);

    // 4. Crear registro de transacción pendiente en base de datos
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

    return {
      transactionId: transaction.id,
      reference,
      amountInDollars,
      amountInCents,
      currency: 'USD',
      publicKey: ENV.WOMPI_PUBLIC_KEY,
      room: {
        id: room.id,
        nombre: room.nombre,
        premio: room.premio,
      },
      redirectUrl: `${ENV.FRONTEND_URL}/rooms/${room.id}?status=success&ref=${reference}`,
    };
  }

  /**
   * Procesa el webhook de Wompi con validación HMAC y ejecución estricta del middleware puedeParticipar.
   */
  public static async processWebhook(payload: WompiWebhookPayload, signatureHeader?: string) {
    console.log('🔔 [Wompi Webhook] Recibido evento:', payload?.event);

    // 1. Validar firma criptográfica HMAC
    const isValidSignature = verifyWompiChecksum(payload, signatureHeader);
    if (!isValidSignature) {
      console.error('❌ [Wompi Webhook] Firma HMAC / Checksum inválido.');
      throw new Error('Firma criptográfica inválida.');
    }

    const transactionData = payload.data?.transaction;
    if (!transactionData) {
      console.warn('⚠️ [Wompi Webhook] Payload no contiene datos de transacción.');
      return { success: false, message: 'Payload sin transacción' };
    }

    const { reference, id: wompiTxId, status, payment_method_type } = transactionData;

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
    if (status !== 'APPROVED') {
      await prisma.transaction.update({
        where: { id: localTx.id },
        data: {
          wompiTransactionId: wompiTxId,
          status: status === 'DECLINED' ? TransactionStatus.DECLINED : TransactionStatus.ERROR,
          paymentMethod: payment_method_type,
        },
      });
      return { success: true, message: `Transacción marcada como ${status}` };
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

    const fechaHoy = getElSalvadorDateString();

    // 4. Transacción atómica en base de datos para asignar pase y actualizar sala
    const result = await prisma.$transaction(async (tx) => {
      // Obtener sala con conteo fresco
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
          paymentMethod: payment_method_type,
        },
      });

      return { newTicket, updatedRoom, updatedTx };
    });

    console.log(`🎟️ [Wompi Webhook] Boleto asignado: ${result.newTicket.ticketNumber} para usuario ${localTx.userId}`);

    // 5. Emitir actualización a Socket.io
    broadcastRoomUpdate(result.updatedRoom.id, {
      roomId: result.updatedRoom.id,
      ticketsSold: result.updatedRoom.ticketsSold,
      capacidadMax: result.updatedRoom.capacidadMax,
      estado: result.updatedRoom.estado,
    });

    // 6. Enviar confirmación por WhatsApp
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
      ticket: result.newTicket,
      roomStatus: result.updatedRoom.estado,
    };
  }
}
