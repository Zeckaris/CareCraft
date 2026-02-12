import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import multer from 'multer';
import {
  getAllBadgeDefinitions,
  getBadgeDefinitionById,
  createBadgeDefinition,
  updateBadgeDefinition,
  deleteBadgeDefinition
} from '../controllers/badgeDefinition.controller.js';

const router = express.Router();


const memoryUpload = multer({ storage: multer.memoryStorage() });

router.get('/', authMiddleware, getAllBadgeDefinitions);
router.get('/:id', authMiddleware, getBadgeDefinitionById);

router.post(
  '/',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  memoryUpload.single('icon'),   
  createBadgeDefinition
);


router.put(
  '/:id',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  memoryUpload.single('icon'),   
  updateBadgeDefinition
);

router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteBadgeDefinition);

export default router;