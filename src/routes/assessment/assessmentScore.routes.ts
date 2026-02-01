import express from 'express'
import {
  generateBulkScores,
  generateSingleScore,
  generateMultipleScores,
  markStageConducted,
  updateAssessmentScore,
  getAllAssessmentScores,
  getAssessmentScoreById,
  deleteAssessmentScore,
  batchUpdateScoresForType
} from '../../controllers/assessment/assessmentScore.controller.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { roleMiddleware } from '../../middlewares/role.middleware.js'

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
router.patch('/batch-type', authMiddleware, roleMiddleware('teacher'), batchUpdateScoresForType)

// DELETE (Teacher only)
router.delete('/:id', authMiddleware, roleMiddleware('teacher'), deleteAssessmentScore)

// CONDUCT STAGE (Teacher only) 
router.post('/grade-subject-assessments/:id/conduct', authMiddleware, roleMiddleware('teacher'), markStageConducted)

export default router