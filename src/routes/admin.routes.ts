import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';
import { requireAdmin } from '../middlewares/admin.middleware';

const router = Router();

// Todas las rutas de administración requieren autenticación y rol ADMIN
router.use(authenticateJWT, requireAdmin);

// Métricas del Dashboard
router.get('/metrics', AdminController.getMetrics);

// CRUD de Salas
router.get('/rooms', AdminController.listAllRooms);
router.post('/rooms', AdminController.createRoom);
router.put('/rooms/:id', AdminController.updateRoom);
router.delete('/rooms/:id', AdminController.deleteRoom);
router.post('/rooms/:id/start', AdminController.startRoom);
router.post('/rooms/:id/draw', AdminController.triggerRoomDraw);

// Reglas Parametrizables de Participación (GameConfig: 6/3)
router.get('/config', AdminController.getGameConfig);
router.put('/config', AdminController.updateGameConfig);

// Configuración de Pasarela Wompi El Salvador (App ID, API Secret, Ambiente)
router.get('/wompi-config', AdminController.getPaymentConfig);
router.put('/wompi-config', AdminController.updatePaymentConfig);
router.post('/wompi-config/test', AdminController.testWompiConnection);

// Configuración de Correo Electrónico (Gmail SMTP / Verificación OTP)
router.get('/email-config', AdminController.getEmailConfig);
router.put('/email-config', AdminController.updateEmailConfig);
router.post('/email-config/test', AdminController.testEmailConnection);

// Gestión de Usuarios (DUI, teléfono, datos bancarios)
router.get('/users', AdminController.getUsers);

// Historial de Sorteos y Botón "Pago Aplicado"
router.get('/sorteos', AdminController.getSorteos);
router.post('/sorteos/:id/payout', AdminController.applyPayout);

export default router;
