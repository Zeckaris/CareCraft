import express from 'express';
import { roleMiddleware } from '../../middlewares/role.middleware';
import { getDashboardStats } from '../../controllers/frontendServicingControllers/dashboard.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';


const router = express.Router();


router.get(
  '/stats',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getDashboardStats
);

export default router;