import express from 'express';
import { roleMiddleware } from '../../middlewares/role.middleware.js';
import { getDashboardStats } from '../../controllers/frontendServicingControllers/dashboard.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';


const router = express.Router();


router.get(
  '/stats',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getDashboardStats
);

export default router;