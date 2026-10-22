import express from 'express'
import {
  createTeachingAssignment,
  getAllTeachingAssignments,
  getTeachingAssignmentById,
  reassignTeacher,
  deleteTeachingAssignment,
} from '../controllers/teachingAssignment.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { roleMiddleware } from '../middlewares/role.middleware.js'

const router = express.Router()

// ── Read (admin + coordinator + teacher) ─────────────────────────────────────
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getAllTeachingAssignments)
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getTeachingAssignmentById)

// ── Write (admin + coordinator) ──────────────────────────────────────────────
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createTeachingAssignment)

// ── Reassign teacher only (admin + coordinator) ──────────────────────────────
router.patch('/:id/reassign', authMiddleware, roleMiddleware('admin', 'coordinator'), reassignTeacher)

// ── Delete (admin + coordinator) ─────────────────────────────────────────────
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), deleteTeachingAssignment)

export default router
