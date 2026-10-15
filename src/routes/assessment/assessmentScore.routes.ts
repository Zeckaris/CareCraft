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

// GET (Admin/Coordinator/Teacher/Parent)
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAllAssessmentScores)
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher', 'parent'), getAssessmentScoreById)

// UPDATE (Admin/Coordinator/Teacher)
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), updateAssessmentScore)
router.patch('/batch-type', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), batchUpdateScoresForType)

// DELETE (Admin/Coordinator/Teacher)
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), deleteAssessmentScore)

// CONDUCT STAGE (Admin/Coordinator/Teacher) 
router.post('/grade-subject-assessments/:id/conduct', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), markStageConducted)

export default router