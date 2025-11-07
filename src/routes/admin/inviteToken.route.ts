import { Router } from 'express';
import { getInviteTokens, deleteInviteToken } from '../../controllers/admin/inviteToken.controller.ts';
import { authMiddleware } from '../../middlewares/auth.middleware.ts';
import { createInviteTokenMiddleware } from '../../middlewares/createInviteToken.middleware.ts'
import { sendInvite } from '../../controllers/admin/inviteToken.controller.ts'
import { roleMiddleware } from '../../middlewares/role.middleware.ts';

const router = Router();

// All routes require authentication
router.use(authMiddleware);


router.post('/send-invite', roleMiddleware('admin'), createInviteTokenMiddleware, sendInvite);
router.post('/resend-invite/:tokenId', roleMiddleware('admin'), sendInvite);
router.get('/token',roleMiddleware('admin'), getInviteTokens);
router.delete('/token/:id', roleMiddleware('admin'), deleteInviteToken);

export default router;
