import {getAllActionPlans, getActionPlanById, createActionPlan, updateActionPlan, deleteActionPlan, getActionPlansByStudent, getActionPlansByTeacher, updateActionPlanStep} from '../controllers/actionPlan.controller.js';
import express from 'express';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';

const router = express.Router();

router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAllActionPlans);
router.get('/student/:studentId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getActionPlansByStudent);
router.get('/teacher/:teacherId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getActionPlansByTeacher);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getActionPlanById);
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), createActionPlan);
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateActionPlan);
router.patch('/:id/step/:stepIndex', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateActionPlanStep);
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteActionPlan);

export default router;