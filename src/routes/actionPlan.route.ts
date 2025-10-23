import {getAllActionPlans, getActionPlanById, createActionPlan, updateActionPlan, deleteActionPlan, getActionPlansByStudent, getActionPlansByTeacher, updateActionPlanStep} from '../controllers/actionPlan.controller';
import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';

const router = express.Router();

router.get('/', authMiddleware, roleMiddleware('admin', 'teacher', 'parent'), getAllActionPlans);
router.get('/student/:studentId', authMiddleware, roleMiddleware('admin', 'teacher', 'parent'), getActionPlansByStudent);
router.get('/teacher/:teacherId', authMiddleware, roleMiddleware('admin', 'teacher', 'parent'), getActionPlansByTeacher);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'teacher', 'parent'), getActionPlanById);
router.post('/', authMiddleware, roleMiddleware('admin', 'teacher'), createActionPlan);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'teacher'), updateActionPlan);
router.patch('/:id/step/:stepIndex', authMiddleware, roleMiddleware('admin', 'teacher'), updateActionPlanStep);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteActionPlan);

export default router;