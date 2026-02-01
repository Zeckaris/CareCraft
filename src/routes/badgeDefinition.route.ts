import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import { createUpload } from '../middlewares/uploads.middleware.js'; 
import {
  getAllBadgeDefinitions,
  getBadgeDefinitionById,
  createBadgeDefinition,
  updateBadgeDefinition,
  deleteBadgeDefinition
} from '../controllers/badgeDefinition.controller.js';

const router = express.Router();

// Create multer instance specifically for badge icons
const uploadBadgeIcon = createUpload('icons/badges');

router.get('/', authMiddleware, getAllBadgeDefinitions);
router.get('/:id', authMiddleware, getBadgeDefinitionById);

// POST and PUT now handle file upload (field name must be "icon")
router.post(
  '/',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  uploadBadgeIcon.single('icon'),
  createBadgeDefinition
);

router.put(
  '/:id',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  uploadBadgeIcon.single('icon'),
  updateBadgeDefinition
);

router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteBadgeDefinition);

export default router;