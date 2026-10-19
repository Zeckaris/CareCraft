import express from 'express';
import {
  getAllConducted,
  getCurrentTermConducted,
  getConductedById,
} from '../controllers/conductedAssessment.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';

/**
 * Read-only conducted-assessment routes.
 *
 * Stage conduct / complete / reopen are on the assessment-scores router:
 *   POST /api/assessment/scores/conduct
 *   POST /api/assessment/scores/complete
 *   POST /api/assessment/scores/reopen
 *
 * There is deliberately no manual "create conducted" or status-only route:
 * the status is always derived from the stage lists, so it can never be
 * inconsistent (e.g. completed with missing stages).
 */
const router = express.Router();

// Current term conducted assessments (teacher-scoped inside the controller).
router.get(
  '/current-term',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  getCurrentTermConducted
);

// Admin + Coordinator + Teacher can list and view conducted assessments (scoped inside the controller)
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getAllConducted);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getConductedById);

export default router;
