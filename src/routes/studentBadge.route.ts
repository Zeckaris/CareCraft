import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import {
  getAllStudentBadges,
  getStudentBadgeById,
  getStudentBadgeProgress,
  createStudentBadge,
  updateStudentBadge,
  updateStudentBadgeGift,
  deleteStudentBadge
} from '../controllers/studentBadge.controller.js';

const router = express.Router();

// Parent can read their child's badges; access scoping is done inside the controller
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAllStudentBadges);
router.get('/progress', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getStudentBadgeProgress);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getStudentBadgeById);
// Homeroom teachers award directly; admins/coordinators have oversight.
// Awards are term-scoped; only the note and gift status may be edited afterwards.
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), createStudentBadge);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateStudentBadge);
// Homeroom teachers may mark a pending gift as given for their current students.
router.patch('/:id/gift', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateStudentBadgeGift);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), deleteStudentBadge);

export default router;
