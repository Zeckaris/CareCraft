import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';
import { requireFeatureForTeachers } from '../middlewares/feature.middleware.js';
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

router.use(authMiddleware, requireFeatureForTeachers('attributeEvaluation'));

router.get('/', roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAllAttributeEvaluations);
router.get('/student/:studentId', roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAttributeEvaluationsByStudent);
router.get('/teacher/:teacherId', roleMiddleware('admin', 'coordinator', 'teacher'), getAttributeEvaluationsByTeacher);
router.get('/:id', roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAttributeEvaluationById);
router.post('/', roleMiddleware('admin', 'coordinator', 'teacher'), createAttributeEvaluation);
router.put('/:id', roleMiddleware('admin', 'coordinator', 'teacher'), updateAttributeEvaluation);
router.patch('/:id', roleMiddleware('admin', 'coordinator', 'teacher'), patchAttributeEvaluation);
router.delete('/:id', roleMiddleware('admin', 'coordinator'), deleteAttributeEvaluation);

export default router;
