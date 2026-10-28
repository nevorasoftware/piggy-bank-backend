import crypto from 'crypto';
import { prisma } from '../config/database';
import { RoomStatus, TicketStatus, PayoutStatus } from '@prisma/client';
import { broadcastSorteoStart, broadcastSorteoWinner, broadcastPayoutApplied } from '../socket/socket.handler';
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
  public static async marcarPagoAplicado(
    sorteoId: string,
    notas?: string
  ) {
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

    // Emitir evento en tiempo real vía Socket.io para que la pantalla del ganador cambie el boleto de amarillo a verde al instante sin F5
    broadcastPayoutApplied({
      sorteoId: updatedSorteo.id,
      roomId: updatedSorteo.roomId,
      ganadorUserId: updatedSorteo.ganadorUserId,
      estadoPago: updatedSorteo.estadoPago,
      montoPremio: Number(updatedSorteo.montoPremio),
      notasPago: updatedSorteo.notasPago || undefined,
      fechaPago: updatedSorteo.fechaPago || new Date(),
    });

    // Enviar notificación de pago aplicado EXCLUSIVAMENTE al correo registrado del ganador
    // Remitente de salida: piggybanksv@gmail.com
    await this.enviarNotificacionPago(sorteoId).catch((err) =>
      console.error('Error al enviar correo de confirmación de pago al ganador:', err)
    );

    // Enviar WhatsApp al ganador confirmando el pago aplicado
    if (sorteo.ganador?.phone) {
      await WhatsAppService.sendPayoutAppliedNotification(
        sorteo.ganador.phone,
        sorteo.ganador.fullName,
        Number(sorteo.montoPremio),
        bankName,
        accountNumber
      ).catch((err) => console.error('Error al enviar WhatsApp de pago aplicado:', err));
    }

    return updatedSorteo;
  }

  /**
   * Resuelve el usuario ganador registrado en la base de datos de manera exhaustiva y robusta.
   * Consulta primero la relación del sorteo, luego la tabla users por ganadorUserId,
   * luego por ticketGanadorId y finalmente por la sala.
   */
  public static async resolverUsuarioGanador(sorteo: any) {
    if (!sorteo) return null;

    // 1. Si la relación ganador ya trajo el usuario completo con su correo
    if (sorteo.ganador?.email && sorteo.ganador.email.trim() !== '') {
      return sorteo.ganador;
    }

    // 2. Consultar directamente a la tabla `users` mediante ganadorUserId
    if (sorteo.ganadorUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sorteo.ganadorUserId },
        include: { bankAccount: true },
      });
      if (user?.email && user.email.trim() !== '') {
        return user;
      }
    }

    // 3. Consultar mediante el ticket ganador registrado en la base
    if (sorteo.ticketGanadorId) {
      const ticket = await prisma.ticket.findUnique({
        where: { id: sorteo.ticketGanadorId },
        include: {
          user: {
            include: { bankAccount: true },
          },
        },
      });
      if (ticket?.user?.email && ticket.user.email.trim() !== '') {
        return ticket.user;
      }
    }

    // 4. Consultar mediante winnerUserId de la sala
    const roomId = sorteo.roomId || sorteo.room?.id;
    if (roomId) {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
      });
      if (room?.winnerUserId) {
        const user = await prisma.user.findUnique({
          where: { id: room.winnerUserId },
          include: { bankAccount: true },
        });
        if (user?.email && user.email.trim() !== '') {
          return user;
        }
      }
    }

    return null;
  }

  /**
   * Envía la notificación de confirmación de pago por correo EXCLUSIVAMENTE al ganador registrado.
   * Remitente de salida: piggybanksv@gmail.com
   * Destinatario: Correo registrado en la cuenta del cliente ganador
   */
  public static async enviarNotificacionPago(sorteoId: string) {
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
      throw new Error('Sorteo no encontrado en la base de datos.');
    }

    const winnerUser = await this.resolverUsuarioGanador(sorteo);
    if (!winnerUser || !winnerUser.email || winnerUser.email.trim() === '') {
      throw new Error('El usuario ganador no posee un correo electrónico registrado en la base de datos.');
    }

    const winningTicket = await prisma.ticket.findUnique({
      where: { id: sorteo.ticketGanadorId },
    });

    const bankName = winnerUser.bankAccount?.bankName || 'Banco en El Salvador';
    const accountNumber = winnerUser.bankAccount?.accountNumber || 'Registrada en perfil';
    const notas = sorteo.notasPago || 'Transferencia efectuada y verificada por administración.';
    const ticketNumber = winningTicket?.ticketNumber || 'TKT-GANADOR';
    const prize = Number(sorteo.montoPremio);
    const winnerEmail = winnerUser.email.trim();

    console.log(`📧 [enviarNotificacionPago] Enviando correo de pago aplicado al usuario registrado: ${winnerEmail} (${winnerUser.fullName})`);

    const res = await EmailService.sendPayoutConfirmedEmail(
      winnerEmail,
      winnerUser.fullName,
      sorteo.room?.nombre || 'Sala de Sorteo',
      ticketNumber,
      prize,
      bankName,
      accountNumber,
      notas
    );

    if (!res.success) {
      console.error(`❌ [enviarNotificacionPago] Error al enviar correo al ganador (${winnerEmail}):`, res.error);
      throw new Error(res.error || `No se pudo enviar el correo al ganador (${winnerEmail}).`);
    }

    console.log(`✅ [enviarNotificacionPago] Correo entregado exitosamente al ganador registrado (${winnerEmail}). MessageId: ${res.messageId}`);

    return {
      success: true,
      winnerEmail,
      winnerName: winnerUser.fullName,
      messageId: res.messageId,
    };
  }

  /**
   * Reenvía la notificación oficial de ganador por correo al usuario registrado en la base de datos.
   */
  public static async enviarNotificacionGanador(sorteoId: string) {
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
      throw new Error('Sorteo no encontrado en la base de datos.');
    }

    const winnerUser = await this.resolverUsuarioGanador(sorteo);
    if (!winnerUser || !winnerUser.email || winnerUser.email.trim() === '') {
      throw new Error('El usuario ganador no posee un correo electrónico registrado en la base de datos.');
    }

    const winningTicket = await prisma.ticket.findUnique({
      where: { id: sorteo.ticketGanadorId },
    });

    const ticketNumber = winningTicket?.ticketNumber || 'TKT-GANADOR';
    const bankDetails = winnerUser.bankAccount
      ? `${winnerUser.bankAccount.bankName} - No. ${winnerUser.bankAccount.accountNumber}`
      : undefined;
    const winnerEmail = winnerUser.email.trim();

    console.log(`📧 [enviarNotificacionGanador] Reenviando notificación de ganador al usuario registrado: ${winnerEmail} (${winnerUser.fullName})`);

    const res = await EmailService.sendWinnerNotificationEmail(
      winnerEmail,
      winnerUser.fullName,
      sorteo.room?.nombre || 'Sala de Sorteo',
      ticketNumber,
      Number(sorteo.montoPremio),
      bankDetails
    );

    if (!res.success) {
      console.error(`❌ [enviarNotificacionGanador] Error al reenviar correo de ganador (${winnerEmail}):`, res.error);
      throw new Error(res.error || `No se pudo enviar la notificación de ganador (${winnerEmail}).`);
    }

    console.log(`✅ [enviarNotificacionGanador] Correo de ganador entregado exitosamente a (${winnerEmail}). MessageId: ${res.messageId}`);

    return {
      success: true,
      winnerEmail,
      winnerName: winnerUser.fullName,
      messageId: res.messageId,
    };
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
