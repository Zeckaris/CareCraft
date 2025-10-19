import express from 'express'
import {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getStudentsByGrade
} from '../controllers/admin/student.controller'
import { authMiddleware } from '../middlewares/auth.middleware'
import { roleMiddleware } from '../middlewares/role.middleware'
import { batchCreateStudents } from '../controllers/admin/student.batch.controller'

const router = express.Router()


router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'),createStudent)
router.post('/batch', authMiddleware, roleMiddleware('admin', 'coordinator'), batchCreateStudents);

router.get('/', authMiddleware, getAllStudents)
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getStudentsByGrade)
router.get('/:id', authMiddleware, getStudentById)
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateStudent)
router.delete('/:id', authMiddleware,roleMiddleware('admin', 'coordinator'), deleteStudent)

export default router
