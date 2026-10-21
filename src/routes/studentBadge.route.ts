import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import {
  getAllStudentBadges,
  getStudentBadgeById,
  createStudentBadge,
  updateStudentBadge,
  deleteStudentBadge
} from '../controllers/studentBadge.controller.js';

const router = express.Router();

// Parent can read their child's badges; access scoping is done inside the controller
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAllStudentBadges);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getStudentBadgeById);
// Homeroom teachers award directly; admins/coordinators have oversight.
// Awards are term-scoped and only the note may be edited afterwards.
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), createStudentBadge);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateStudentBadge);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), deleteStudentBadge);

export default router;