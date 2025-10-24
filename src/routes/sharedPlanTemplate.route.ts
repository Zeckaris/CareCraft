import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import { templateOwnershipMiddleware } from '../middlewares/templateAuthorization.middleware';
import {
  createTemplateFromActionPlan,
  getAllTemplates,
  getTemplateById,
  applyTemplate,
  rateTemplate,
  updateTemplate,
  deleteTemplate,
} from '../controllers/sharedPlanTemplate.controller';

const router = express.Router();

router.get('/', authMiddleware, getAllTemplates);

router.get('/:id', authMiddleware, getTemplateById);

router.post('/from-action-plan/:actionPlanId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), templateOwnershipMiddleware, createTemplateFromActionPlan);
router.post('/:id/apply', authMiddleware, roleMiddleware('teacher', 'parent', 'admin'), templateOwnershipMiddleware, applyTemplate);

// Rate a template (teachers, parents who applied it)
router.post('/:id/rate', authMiddleware, roleMiddleware('teacher', 'parent', 'admin'), templateOwnershipMiddleware, rateTemplate);

router.put('/:id', authMiddleware, templateOwnershipMiddleware, updateTemplate);

router.delete('/:id', authMiddleware, templateOwnershipMiddleware, deleteTemplate);

export default router;