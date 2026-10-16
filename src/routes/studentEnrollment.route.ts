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
  bulkCreateEnrollments,
  moveEnrollmentSection,
  bulkMoveEnrollmentSections,
  getUnassignedEnrollments,
} from '../controllers/studentEnrollment.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { roleMiddleware } from '../middlewares/role.middleware.js'

const router = express.Router()

router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAllEnrollments)
router.get('/student/:studentId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getStudentEnrollments)
router.get('/grade/:gradeId', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getGradeEnrollments)

// Must be defined before /:id routes
router.get('/unassigned', authMiddleware, roleMiddleware('admin', 'coordinator'), getUnassignedEnrollments)

// Bulk move must be defined before /:id routes
router.post('/bulk-move-section', authMiddleware, roleMiddleware('admin', 'coordinator'), bulkMoveEnrollmentSections)

router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getEnrollmentById)

router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createEnrollment)
router.post('/bulk', authMiddleware, roleMiddleware('admin', 'coordinator'), bulkCreateEnrollments)

router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateEnrollment)
router.patch('/:id/active', authMiddleware, roleMiddleware('admin', 'coordinator'), toggleEnrollmentActive)
router.patch('/:id/section', authMiddleware, roleMiddleware('admin', 'coordinator'), moveEnrollmentSection)

router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteEnrollment)

export default router