import { Router } from 'express';
import { TicketController } from '../controllers/ticket.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';
import { participationGuardMiddleware } from '../middlewares/participation.middleware';

const router = Router();

// Iniciar sesión de pago con Wompi - protegido por autenticación y reglas 6/3
router.post(
  '/checkout',
  authenticateJWT,
  participationGuardMiddleware,
  TicketController.initiateCheckout
);

// Consultar boleto / pase digital en sala
router.get('/my-pass/:roomId', authenticateJWT, TicketController.getMyPassForRoom);

export default router;
