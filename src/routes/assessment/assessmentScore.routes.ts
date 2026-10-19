import express from 'express'
import {
  getClassSheet,
  getResultsSheet,
  writeScores,
  conductStage,
  completeStage,
  reopenStage,
  getAssessmentScoreById,
  updateAssessmentScore,
  deleteAssessmentScore,
} from '../../controllers/assessment/assessmentScore.controller.js'
import { authMiddleware } from '../../middlewares/auth.middleware.js'
import { roleMiddleware } from '../../middlewares/role.middleware.js'

const router = express.Router()

// ── Teacher class sheet (full marks for the teacher's own section+subject) ────
router.get('/class-sheet', authMiddleware, roleMiddleware('teacher'), getClassSheet)

// ── Admin/coordinator results (locked stages only; read-only) ────────────────
router.get(
  '/results',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getResultsSheet
)

// ── Offline-safe batch write (one stage per request) ─────────────────────────
router.post(
  '/write',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  writeScores
)

// ── Stage lifecycle ──────────────────────────────────────────────────────────
router.post(
  '/conduct',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  conductStage
)
router.post(
  '/complete',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  completeStage
)
router.post(
  '/reopen',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  reopenStage
)

// ── Single marksheet read / edit / delete ────────────────────────────────────
router.get(
  '/:id',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher', 'parent'),
  getAssessmentScoreById
)
router.put(
  '/:id',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  updateAssessmentScore
)
router.delete(
  '/:id',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  deleteAssessmentScore
)

export default router
