import { Router, Request, Response } from 'express';
import authRoutes from './auth.routes';
import roomRoutes from './room.routes';
import ticketRoutes from './ticket.routes';
import userRoutes from './user.routes';
import webhookRoutes from './webhook.routes';
import adminRoutes from './admin.routes';
import { prisma } from '../config/database';
import { getElSalvadorDateString } from '../utils/date';

const router = Router();

// Endpoint de Healthcheck para Railway
router.get('/health', async (_req: Request, res: Response) => {
  try {
    // Verificar conexión a la base de datos PostgreSQL
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      service: 'piggy-bank-backend',
      timestamp: new Date().toISOString(),
      timezone: 'America/El_Salvador',
      currentDate: getElSalvadorDateString(),
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Base de datos no disponible.',
    });
  }
});

// Enrutadores de la API
router.use('/auth', authRoutes);
router.use('/rooms', roomRoutes);
router.use('/tickets', ticketRoutes);
router.use('/users', userRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/admin', adminRoutes);

export default router;
