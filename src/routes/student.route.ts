import express from 'express'
import {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getStudentsByGrade
} from '../controllers/admin/student.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { roleMiddleware } from '../middlewares/role.middleware.js'
import { batchCreateStudents } from '../controllers/admin/student.batch.controller.js'
import multer from 'multer';  

const router = express.Router()

const memoryUpload = multer({ storage: multer.memoryStorage() });

router.post(
  '/',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  memoryUpload.single('profileImage'), 
  createStudent
)

router.post('/batch', authMiddleware, roleMiddleware('admin', 'coordinator'), batchCreateStudents);

router.get('/', authMiddleware, async (req, res) => {
  if (req.query.gradeId) {
    return getStudentsByGrade(req, res);
  }
  return getAllStudents(req, res);
});
router.get('/:id', authMiddleware, getStudentById)

router.put(
  '/:id',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  memoryUpload.single('profileImage'),  
  updateStudent
)

router.delete('/:id', authMiddleware,roleMiddleware('admin', 'coordinator'), deleteStudent)

export default router