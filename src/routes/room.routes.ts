import { Router } from 'express';
import { RoomController } from '../controllers/room.controller';

const router = Router();

router.get('/', RoomController.getRooms);
router.get('/:id', RoomController.getRoomById);
router.post('/:id/draw-if-ready', RoomController.autoDrawRoomIfReady);

export default router;
