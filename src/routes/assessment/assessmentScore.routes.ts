import express from 'express'
import {
  generateBulkScores,
  generateSingleScore,
  generateMultipleScores,
  markStageConducted,
  updateAssessmentScore,
  getAllAssessmentScores,
  getAssessmentScoreById,
  deleteAssessmentScore
} from '../../controllers/assessment/assessmentScore.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { roleMiddleware } from '../../middlewares/role.middleware'

const router = express.Router()

// GENERATION (Admin/Coordinator/Teacher)
router.post('/generate/bulk', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), generateBulkScores)
router.post('/generate/single', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), generateSingleScore)
router.post('/generate/multiple', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), generateMultipleScores)

// GET (Any authenticated)
router.get('/', authMiddleware, getAllAssessmentScores)
router.get('/:id', authMiddleware, getAssessmentScoreById)

// UPDATE (Teacher only)
router.put('/:id', authMiddleware, roleMiddleware('teacher'), updateAssessmentScore)

// DELETE (Teacher only)
router.delete('/:id', authMiddleware, roleMiddleware('teacher'), deleteAssessmentScore)

// CONDUCT STAGE (Teacher only) - Note: /grade-subject-assessments/:id/conduct
router.post('/grade-subject-assessments/:id/conduct', authMiddleware, roleMiddleware('teacher'), markStageConducted)

export default router