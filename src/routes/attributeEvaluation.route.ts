import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';
import {
  getAllAttributeEvaluations,
  getAttributeEvaluationsByStudent,
  getAttributeEvaluationsByTeacher,
  getAttributeEvaluationById,
  createAttributeEvaluation,
  updateAttributeEvaluation,
  patchAttributeEvaluation,
  deleteAttributeEvaluation
} from '../controllers/attributeEvaluation.controller';

const router = Router();

router.get('/', authMiddleware, roleMiddleware('admin', 'teacher', 'parent'), getAllAttributeEvaluations);
router.get('/student/:studentId', authMiddleware, roleMiddleware('admin', 'teacher', 'parent'), getAttributeEvaluationsByStudent);
router.get('/teacher/:teacherId', authMiddleware, roleMiddleware('admin', 'teacher', 'parent'), getAttributeEvaluationsByTeacher);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'teacher', 'parent'), getAttributeEvaluationById);
router.post('/', authMiddleware, roleMiddleware('admin', 'teacher'), createAttributeEvaluation);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'teacher'), updateAttributeEvaluation);
router.patch('/:id', authMiddleware, roleMiddleware('admin', 'teacher'), patchAttributeEvaluation);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteAttributeEvaluation);

export default router;