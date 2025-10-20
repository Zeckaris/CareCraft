import express from 'express'
import {
  getAllEnrollments,
  getStudentEnrollments,
  getEnrollmentById,
  createEnrollment,
  updateEnrollment,
  toggleEnrollmentActive,
  deleteEnrollment,
  getGradeEnrollments,
  bulkCreateEnrollments
} from '../controllers/studentEnrollment.controller'
import { authMiddleware } from '../middlewares/auth.middleware'
import { roleMiddleware } from '../middlewares/role.middleware'

const router = express.Router()


router.get('/', authMiddleware, getAllEnrollments)
router.get('/student/:studentId', authMiddleware, getStudentEnrollments)
router.get('/grade/:gradeId', authMiddleware, getGradeEnrollments)
router.get('/:id', authMiddleware, getEnrollmentById)


router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createEnrollment)
router.post('/bulk', authMiddleware, roleMiddleware('admin', 'coordinator'), bulkCreateEnrollments)


router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateEnrollment)
router.patch('/:id/active', authMiddleware, roleMiddleware('admin', 'coordinator'), toggleEnrollmentActive)

router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteEnrollment)

export default router