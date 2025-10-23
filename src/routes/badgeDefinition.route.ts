import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import {
  getAllBadgeDefinitions,
  getBadgeDefinitionById,
  createBadgeDefinition,
  updateBadgeDefinition,
  deleteBadgeDefinition
} from '../controllers/badgeDefinition.controller';

const router = express.Router();

router.get('/', authMiddleware, getAllBadgeDefinitions);
router.get('/:id', authMiddleware, getBadgeDefinitionById);
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createBadgeDefinition);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateBadgeDefinition);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteBadgeDefinition);

export default router;