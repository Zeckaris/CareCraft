import express from 'express';
import { roleMiddleware } from '../../middlewares/role.middleware.js';
import {
  getAttendanceComplianceStats,
  getAttendanceSnapshotStats,
  getChronicAbsenteeStats,
  getClassPerformanceStats,
  getDashboardStats,
  getPerformanceAlertStats,
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

router.get(
  '/attendance-compliance',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getAttendanceComplianceStats
);

router.get(
  '/chronic-absentees',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getChronicAbsenteeStats
);

router.get(
  '/performance-alerts',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getPerformanceAlertStats
);

export default router;