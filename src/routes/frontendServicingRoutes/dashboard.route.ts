import express from 'express';
import { roleMiddleware } from '../../middlewares/role.middleware.js';
import {
  getAttendanceSnapshotStats,
  getClassPerformanceStats,
  getDashboardStats,
} from '../../controllers/frontendServicingControllers/dashboard.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';


const router = express.Router();


router.get(
  '/stats',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getDashboardStats
);

router.get(
  '/attendance-snapshot',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getAttendanceSnapshotStats
);

router.get(
  '/class-performance',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getClassPerformanceStats
);

export default router;