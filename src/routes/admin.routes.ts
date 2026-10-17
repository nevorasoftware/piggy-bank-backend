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
router.post('/rooms/:id/draw', AdminController.triggerRoomDraw);

// Reglas Parametrizables de Participación (GameConfig: 6/3)
router.get('/config', AdminController.getGameConfig);
router.put('/config', AdminController.updateGameConfig);

// Gestión de Usuarios (DUI, teléfono, datos bancarios)
router.get('/users', AdminController.getUsers);

// Historial de Sorteos y Botón "Pago Aplicado"
router.get('/sorteos', AdminController.getSorteos);
router.post('/sorteos/:id/payout', AdminController.applyPayout);

export default router;
