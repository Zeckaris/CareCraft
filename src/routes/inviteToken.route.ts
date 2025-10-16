import { Router } from 'express';
import { createInviteToken, getInviteTokens, deleteInviteToken } from '../controllers/inviteToken.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authMiddleware);


router.post('/tokens', createInviteToken);
router.get('/tokens', getInviteTokens);
router.delete('/tokens/:id', deleteInviteToken);

export default router;
