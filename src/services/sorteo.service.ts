import crypto from 'crypto';
import { prisma } from '../config/database';
import { RoomStatus, TicketStatus, PayoutStatus } from '@prisma/client';
import { broadcastSorteoStart, broadcastSorteoWinner } from '../socket/socket.handler';
import { WhatsAppService } from './whatsapp.service';
import { EmailService } from './email.service';
import { getElSalvadorDateString } from '../utils/date';

export class SorteoService {
  /**
   * Ejecuta el sorteo para una sala de manera determinística y segura.
   */
  public static async ejecutarSorteo(roomId: string) {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        tickets: {
          where: { estado: TicketStatus.ACTIVO },
          include: {
            user: {
              include: { bankAccount: true },
            },
          },
        },
      },
    });

    if (!room) {
      throw new Error('La sala no existe.');
    }

    if (room.estado === RoomStatus.FINALIZADA) {
      throw new Error('Este sorteo ya fue finalizado.');
    }

    if (room.tickets.length === 0) {
      // Si no hubo participantes, marcar como cerrada
      await prisma.room.update({
        where: { id: room.id },
        data: { estado: RoomStatus.CERRADA },
      });
      throw new Error('No hay boletos activos para sortear en esta sala.');
    }

    // 1. Notificar inicio de animación de ruleta a los clientes
    await prisma.room.update({
      where: { id: room.id },
      data: { estado: RoomStatus.SORTEANDO },
    });

    broadcastSorteoStart(room.id, {
      roomId: room.id,
      nombre: room.nombre,
      premio: Number(room.premio),
      totalBoletos: room.tickets.length,
      tickets: room.tickets.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
      })),
    });

    // 2. Selección de ganador mediante generador criptográfico seguro
    const winningIndex = crypto.randomInt(0, room.tickets.length);
    const winningTicket = room.tickets[winningIndex];
    const winnerUser = winningTicket.user;

    // 3. Transacción atómica para actualizar tickets, sala y registrar Sorteo
    const sorteo = await prisma.$transaction(async (tx) => {
      // Marcar ticket ganador
      await tx.ticket.update({
        where: { id: winningTicket.id },
        data: { estado: TicketStatus.GANADOR },
      });

      // Marcar resto de tickets como no ganadores
      await tx.ticket.updateMany({
        where: {
          roomId: room.id,
          id: { not: winningTicket.id },
        },
        data: { estado: TicketStatus.NO_GANADOR },
      });

      // Finalizar sala
      await tx.room.update({
        where: { id: room.id },
        data: {
          estado: RoomStatus.FINALIZADA,
          winnerUserId: winnerUser.id,
          winnerTicketId: winningTicket.id,
        },
      });

      // Registrar sorteo con pago pendiente
      const nuevoSorteo = await tx.sorteo.create({
        data: {
          roomId: room.id,
          ganadorUserId: winnerUser.id,
          ticketGanadorId: winningTicket.id,
          montoPremio: room.premio,
          estadoPago: PayoutStatus.PENDIENTE,
        },
        include: {
          room: true,
          ganador: {
            include: { bankAccount: true },
          },
        },
      });

      return nuevoSorteo;
    });

    // 4. Emitir evento del ganador con ticket y efectos visuales
    // Mascarar nombre del ganador para privacidad pública (ej. Carlos R.)
    const nameParts = winnerUser.fullName.split(' ');
    const maskedName =
      nameParts.length > 1
        ? `${nameParts[0]} ${nameParts[1].charAt(0)}.`
        : winnerUser.fullName;

    broadcastSorteoWinner(room.id, {
      roomId: room.id,
      sorteoId: sorteo.id,
      ticketGanador: winningTicket.ticketNumber,
      ganadorNombre: maskedName,
      premio: Number(room.premio),
      fecha: sorteo.fechaSorteo,
      winnerUserId: winnerUser.id,
    });

    // 5. Notificar al ganador por Correo Electrónico
    const bankDetails = winnerUser.bankAccount
      ? `${winnerUser.bankAccount.bankName} - No. ${winnerUser.bankAccount.accountNumber}`
      : undefined;

    if (winnerUser.email) {
      EmailService.sendWinnerNotificationEmail(
        winnerUser.email,
        winnerUser.fullName,
        room.nombre,
        winningTicket.ticketNumber,
        Number(room.premio),
        bankDetails
      ).catch((err) => console.error('Error al enviar correo al ganador:', err));
    }

    // 6. Notificar al ganador por WhatsApp
    if (winnerUser.phone) {
      await WhatsAppService.sendWinnerNotification(
        winnerUser.phone,
        winnerUser.fullName,
        room.nombre,
        Number(room.premio),
        bankDetails || 'Pendiente de registrar en tu perfil'
      );
    }

    // 7. Notificar a los demás participantes
    for (const ticket of room.tickets) {
      if (ticket.userId !== winnerUser.id && ticket.user.phone) {
        WhatsAppService.sendNonWinnerNotification(ticket.user.phone, room.nombre).catch(() => {});
      }
    }

    return sorteo;
  }

  /**
   * Acción Administrativa: Marcar "Pago Aplicado" a un sorteo ganado.
   * Envía confirmación de transferencia por WhatsApp e incrementa las victorias del usuario.
   */
  public static async marcarPagoAplicado(sorteoId: string, notas?: string) {
    const sorteo = await prisma.sorteo.findUnique({
      where: { id: sorteoId },
      include: {
        room: true,
        ganador: {
          include: { bankAccount: true },
        },
      },
    });

    if (!sorteo) {
      throw new Error('Sorteo no encontrado.');
    }

    if (sorteo.estadoPago === PayoutStatus.PAGADO) {
      throw new Error('Este sorteo ya ha sido marcado como pagado previamente.');
    }

    const fechaHoy = getElSalvadorDateString();

    // Actualizar estado del pago e incrementar victorias diarias del usuario
    const updatedSorteo = await prisma.$transaction(async (tx) => {
      const updated = await tx.sorteo.update({
        where: { id: sorteoId },
        data: {
          estadoPago: PayoutStatus.PAGADO,
          fechaPago: new Date(),
          notasPago: notas || 'Pago verificado y transferido por administración.',
        },
        include: {
          room: true,
          ganador: {
            include: { bankAccount: true },
          },
        },
      });

      // Incrementar victorias del ganador hoy
      await tx.dailyUserStats.upsert({
        where: {
          userId_fecha: {
            userId: sorteo.ganadorUserId,
            fecha: fechaHoy,
          },
        },
        update: {
          victorias: { increment: 1 },
        },
        create: {
          userId: sorteo.ganadorUserId,
          fecha: fechaHoy,
          participaciones: 0,
          victorias: 1,
        },
      });

      return updated;
    });

    const bankName = sorteo.ganador.bankAccount?.bankName || 'Cuenta Bancaria';
    const accountNumber = sorteo.ganador.bankAccount?.accountNumber || 'Registrada en perfil';

    // Enviar Correo al ganador confirmando el pago aplicado
    if (sorteo.ganador?.email) {
      const winningTicket = await prisma.ticket.findUnique({
        where: { id: sorteo.ticketGanadorId },
      });

      EmailService.sendPayoutConfirmedEmail(
        sorteo.ganador.email,
        sorteo.ganador.fullName,
        sorteo.room.nombre,
        winningTicket?.ticketNumber || 'TKT-GANADOR',
        Number(sorteo.montoPremio),
        bankName,
        accountNumber,
        notas || 'Pago verificado y transferido por administración.'
      ).catch((err) => console.error('Error al enviar correo de pago aplicado:', err));
    }

    // Enviar WhatsApp al ganador confirmando el pago aplicado
    if (sorteo.ganador?.phone) {
      await WhatsAppService.sendPayoutAppliedNotification(
        sorteo.ganador.phone,
        sorteo.ganador.fullName,
        Number(sorteo.montoPremio),
        bankName,
        accountNumber
      );
    }

    return updatedSorteo;
  }

  /**
   * Obtiene el historial completo de sorteos para el panel de administración
   */
  public static async getHistorialSorteos() {
    return prisma.sorteo.findMany({
      orderBy: { fechaSorteo: 'desc' },
      include: {
        room: true,
        ganador: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            dui: true,
            bankAccount: true,
          },
        },
      },
    });
  }
}
