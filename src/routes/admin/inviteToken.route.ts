import { Router } from 'express';
import { getInviteTokens, deleteInviteToken } from '../../controllers/admin/inviteToken.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { createInviteTokenMiddleware } from '../../middlewares/createInviteToken.middleware.js'
import { sendInvite } from '../../controllers/admin/inviteToken.controller.js'
import { roleMiddleware } from '../../middlewares/role.middleware.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);


router.post('/send-invite', roleMiddleware('admin'), createInviteTokenMiddleware, sendInvite);
router.post('/resend-invite/:tokenId', roleMiddleware('admin'), sendInvite);
router.get('/token',roleMiddleware('admin'), getInviteTokens);
router.delete('/token/:id', roleMiddleware('admin'), deleteInviteToken);

export default router;
