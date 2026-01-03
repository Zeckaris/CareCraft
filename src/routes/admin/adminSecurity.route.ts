import express from 'express';
import {
  toggleMfa,
  suspendUser,
  unsuspendUser,
} from '../../controllers/admin/adminSecurity.controller.ts'
import { authMiddleware } from '../../middlewares/auth.middleware.ts';
import { roleMiddleware } from '../../middlewares/role.middleware.ts';

const router = express.Router();


router.patch('/mfa', authMiddleware, roleMiddleware('admin'),toggleMfa);

router.patch('/users/:userId/suspend', authMiddleware, roleMiddleware('admin', 'coordinator'), suspendUser);

router.patch('/users/:userId/unsuspend', authMiddleware, roleMiddleware('admin', 'coordinator'), unsuspendUser);

export default router;