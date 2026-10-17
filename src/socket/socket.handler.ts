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
  }
}

/**
 * Emite la proclamación del ganador con ticket y efectos
 */
export function broadcastSorteoWinner(roomId: string, data: any): void {
  if (io) {
    io.to(`room_${roomId}`).emit('sorteo:ganador', data);
    io.emit('rooms:list_update', { roomId, estado: 'FINALIZADA' });
  }
}
