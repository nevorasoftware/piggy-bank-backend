import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { ENV } from '../config/env';

export let io: Server;

export function initSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: [ENV.FRONTEND_URL, 'http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket: Socket) => {
    console.log(`🔌 Cliente conectado a Socket.io: ${socket.id}`);

    // Unirse a una sala específica de sorteo
    socket.on('join_room', (roomId: string) => {
      socket.join(`room_${roomId}`);
      console.log(`👤 Socket ${socket.id} se unió a la sala: room_${roomId}`);
    });

    // Salir de una sala
    socket.on('leave_room', (roomId: string) => {
      socket.leave(`room_${roomId}`);
      console.log(`🚪 Socket ${socket.id} salió de la sala: room_${roomId}`);
    });

    // Unirse al canal personal del usuario logueado para eventos en tiempo real
    socket.on('join_user', (userId: string) => {
      if (userId) {
        socket.join(`user_${userId}`);
        console.log(`👤 Socket ${socket.id} se unió al canal de usuario: user_${userId}`);
      }
    });

    socket.on('leave_user', (userId: string) => {
      if (userId) {
        socket.leave(`user_${userId}`);
        console.log(`🚪 Socket ${socket.id} salió del canal de usuario: user_${userId}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`❌ Socket desconectado: ${socket.id}`);
    });
  });

  return io;
}

/**
 * Emite una actualización de estado de una sala a todos los miembros en ella.
 */
export function broadcastRoomUpdate(roomId: string, data: any): void {
  if (io) {
    io.to(`room_${roomId}`).emit('room:update', data);
    io.emit('rooms:list_update', data); // Notificar también a la lista general de salas
  }
}

/**
 * Emite el inicio del sorteo animado (ruleta girando)
 */
export function broadcastSorteoStart(roomId: string, data: any): void {
  if (io) {
    io.to(`room_${roomId}`).emit('sorteo:iniciar', data);
    io.emit('global:sorteo_start', data);
  }
}

/**
 * Emite la proclamación del ganador con ticket y efectos
 */
export function broadcastSorteoWinner(roomId: string, data: any): void {
  if (io) {
    io.to(`room_${roomId}`).emit('sorteo:ganador', data);
    io.emit('rooms:list_update', { roomId, estado: 'FINALIZADA', ...data });
    io.emit('global:sorteo_winner', data);
  }
}

/**
 * Emite la confirmación de pago aplicado de un sorteo para actualizar en tiempo real
 * la pantalla del usuario ganador (cambiar ticket de amarillo a verde) sin recargar la página.
 */
export function broadcastPayoutApplied(data: {
  sorteoId: string;
  roomId: string;
  ganadorUserId: string;
  estadoPago: string;
  montoPremio: number;
  notasPago?: string;
  fechaPago?: Date | string;
}): void {
  if (io) {
    console.log(`⚡ [Socket] Transmitiendo evento de pago aplicado para ganador: ${data.ganadorUserId} en sala: ${data.roomId}`);
    // 1. Emitir a la sala de sorteo
    io.to(`room_${data.roomId}`).emit('payout:applied', data);
    io.to(`room_${data.roomId}`).emit('room:update', { action: 'payout_applied', ...data });

    // 2. Emitir directamente al canal personal del usuario ganador
    io.to(`user_${data.ganadorUserId}`).emit('user:payout_applied', data);

    // 3. Emitir a nivel global (para actualizar perfil /profile o listas de boletos de cualquier pantalla activa)
    io.emit('global:payout_applied', data);
    io.emit('rooms:list_update', { action: 'payout_applied', ...data });
  }
}

