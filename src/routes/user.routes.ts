import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

router.put('/bank-account', authenticateJWT, UserController.updateBankAccount);
router.get('/participation-status', authenticateJWT, UserController.getParticipationStatus);
router.get('/my-tickets', authenticateJWT, UserController.getMyTickets);

export default router;
