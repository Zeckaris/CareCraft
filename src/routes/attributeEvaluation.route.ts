import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import {
  getAllAttributeEvaluations,
  getAttributeEvaluationsByStudent,
  getAttributeEvaluationsByTeacher,
  getAttributeEvaluationById,
  createAttributeEvaluation,
  updateAttributeEvaluation,
  patchAttributeEvaluation,
  deleteAttributeEvaluation
} from '../controllers/attributeEvaluation.controller.js';

const router = Router();

router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAllAttributeEvaluations);
router.get('/student/:studentId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAttributeEvaluationsByStudent);
router.get('/teacher/:teacherId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAttributeEvaluationsByTeacher);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAttributeEvaluationById);
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), createAttributeEvaluation);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateAttributeEvaluation);
router.patch('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), patchAttributeEvaluation);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteAttributeEvaluation);

export default router;