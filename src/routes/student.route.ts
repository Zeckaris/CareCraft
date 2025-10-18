import express from 'express'
import {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
} from '../controllers/admin/student.controller'
import { authMiddleware } from '../middlewares/auth.middleware'
import { roleMiddleware } from '../middlewares/role.middleware'

const router = express.Router()


router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'),createStudent)

router.get('/', authMiddleware, getAllStudents)
router.get('/:id', authMiddleware, getStudentById)
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateStudent)
router.delete('/:id', authMiddleware,roleMiddleware('admin', 'coordinator'), deleteStudent)

export default router
