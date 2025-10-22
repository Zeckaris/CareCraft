import express from 'express';
import {
  getAllAttributeCategories,
  getAttributeCategoryById,
  createAttributeCategory,
  updateAttributeCategory,
  deleteAttributeCategory
} from '../controllers/attributeCategory.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';

const router = express.Router();

router.get('/', authMiddleware, getAllAttributeCategories);
router.get('/:id', authMiddleware, getAttributeCategoryById);
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createAttributeCategory);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateAttributeCategory);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteAttributeCategory);

export default router;