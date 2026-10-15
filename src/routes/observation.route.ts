import express from 'express';
import {
  getAllObservations,
  getObservationById,
  createObservation,
  updateObservation,
  deleteObservation, 
  getObservationsByTeacherAndGrade,
  bulkDeleteObservationsByStudent,
  getObservationsByTeacher,
  getObservationsByStudentAndDate,
  getObservationsByCategoryAndGrade
} from '../controllers/observation.controller.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';

const router = express.Router();


router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAllObservations);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getObservationById);

router.get('/student/:studentId/date', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getObservationsByStudentAndDate);
router.get('/teacher/:teacherId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getObservationsByTeacher);
router.get('/teacher/:teacherId/grade/:gradeId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getObservationsByTeacherAndGrade);
router.get('/category/:gradeId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getObservationsByCategoryAndGrade);

router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), createObservation);

router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateObservation);

router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), deleteObservation);
router.delete('/student/:studentId', authMiddleware, roleMiddleware('admin', 'coordinator'), bulkDeleteObservationsByStudent);

export default router;