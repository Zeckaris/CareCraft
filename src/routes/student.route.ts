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

const router = express.Router()


router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'),createStudent)
router.post('/batch', authMiddleware, roleMiddleware('admin', 'coordinator'), batchCreateStudents);

router.get('/', authMiddleware, async (req, res) => {
  if (req.query.gradeId) {
    return getStudentsByGrade(req, res);
  }
  return getAllStudents(req, res);
});
router.get('/:id', authMiddleware, getStudentById)
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateStudent)
router.delete('/:id', authMiddleware,roleMiddleware('admin', 'coordinator'), deleteStudent)

export default router
