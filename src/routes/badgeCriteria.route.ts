import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import {
  getAllBadgeCriteria,
  getBadgeCriteriaById,
  createBadgeCriteria,
  updateBadgeCriteria,
  deleteBadgeCriteria
} from '../controllers/badgeCriteria.controller';

const router = express.Router();

router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getAllBadgeCriteria);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getBadgeCriteriaById);
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createBadgeCriteria);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateBadgeCriteria);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteBadgeCriteria);

export default router;