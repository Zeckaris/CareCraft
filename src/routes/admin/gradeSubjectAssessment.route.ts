import express from 'express'
import {
  createGradeSubjectAssessment,
  getAllGradeSubjectAssessments,
  getGradeSubjectAssessmentById,
  getByGradeLevel,
  updateGradeSubjectAssessment,
  deleteGradeSubjectAssessment
} from '../../controllers/admin/gradeSubjectAssessment.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { roleMiddleware } from '../../middlewares/role.middleware'

const router = express.Router()

// available for admin, coordinator and teacher
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getAllGradeSubjectAssessments)
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getGradeSubjectAssessmentById)
router.get('/grade/:level', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getByGradeLevel)

//  available for admin and coordinator only
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createGradeSubjectAssessment)
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateGradeSubjectAssessment)
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteGradeSubjectAssessment)

export default router