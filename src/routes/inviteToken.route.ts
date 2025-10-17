import { Router } from 'express';
import { getInviteTokens, deleteInviteToken } from '../controllers/inviteToken.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { createInviteTokenMiddleware } from '../middlewares/createInviteToken.middleware'
import { sendInvite } from '../controllers/inviteToken.controller'

const router = Router();

// All routes require authentication
router.use(authMiddleware);


router.post('/send-invite', authMiddleware, createInviteTokenMiddleware, sendInvite);
router.post('/resend-invite/:tokenId', authMiddleware, sendInvite);
router.get('/token',authMiddleware, getInviteTokens);
router.delete('/token/:id', authMiddleware, deleteInviteToken);

export default router;
