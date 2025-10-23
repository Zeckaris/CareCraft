import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import {
  getAllStudentBadges,
  getStudentBadgeById,
  createStudentBadge,
  updateStudentBadge,
  deleteStudentBadge
} from '../controllers/studentBadge.controller';

const router = express.Router();

router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getAllStudentBadges);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getStudentBadgeById);
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), createStudentBadge);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateStudentBadge);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), deleteStudentBadge);

export default router;