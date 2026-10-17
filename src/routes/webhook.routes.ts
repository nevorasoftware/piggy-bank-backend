import { Router } from 'express';
import { WebhookController } from '../controllers/webhook.controller';

const router = Router();

// Webhook oficial de Wompi El Salvador: https://<backend-url>/api/webhooks/wompi
router.post('/wompi', WebhookController.handleWompiWebhook);

export default router;
