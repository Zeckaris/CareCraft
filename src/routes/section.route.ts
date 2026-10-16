import express from 'express'
import {
  createSection,
  getAllSections,
  getSectionById,
  updateSection,
  deleteSection,
  getSectionRoster,
  getMySections,
  generateSections,
} from '../controllers/section.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { roleMiddleware } from '../middlewares/role.middleware.js'

const router = express.Router()

// ── Teacher self-service (must come before /:id to avoid route conflict) ─────
router.get('/my', authMiddleware, roleMiddleware('teacher'), getMySections)

// ── Roster (admin + coordinator + teacher) ───────────────────────────────────
router.get('/:id/roster', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getSectionRoster)

// ── List / Read (admin + coordinator + teacher) ──────────────────────────────
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getAllSections)
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getSectionById)

// ── Write (admin + coordinator) ──────────────────────────────────────────────
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createSection)
router.post('/generate', authMiddleware, roleMiddleware('admin', 'coordinator'), generateSections)
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), updateSection)

// ── Delete (admin + coordinator) ─────────────────────────────────────────────
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteSection)

export default router
