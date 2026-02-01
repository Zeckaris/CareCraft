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


router.get('/', authMiddleware, getAllObservations);
router.get('/:id', authMiddleware, getObservationById);

router.get('/student/:studentId/date', authMiddleware, getObservationsByStudentAndDate);
router.get('/teacher/:teacherId', authMiddleware, getObservationsByTeacher);
router.get('/teacher/:teacherId/grade/:gradeId', authMiddleware, getObservationsByTeacherAndGrade);
router.get('/category/:gradeId', authMiddleware, roleMiddleware('teacher'), getObservationsByCategoryAndGrade);


router.post('/', authMiddleware, roleMiddleware('teacher'), createObservation);


router.put('/:id', authMiddleware, roleMiddleware('teacher'), updateObservation);


router.delete('/:id', authMiddleware, roleMiddleware('teacher'), deleteObservation);
router.delete('/student/:studentId', authMiddleware, roleMiddleware('admin'), bulkDeleteObservationsByStudent);

export default router;