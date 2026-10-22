/**
 * attendance.route.ts
 *
 * All routes are mounted at /api/attendance (registered in index.ts).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Method │ Path                                  │ Allowed roles            │
 * ├──────────────────────────────────────────────────────────────────────────┤
 * │ POST   │ /section/:sectionId/date/:date        │ admin, coordinator,      │
 * │        │                                       │ teacher (homeroom only)  │
 * │ GET    │ /section/:sectionId/date/:date        │ admin, coordinator,      │
 * │        │                                       │ teacher                  │
 * │ GET    │ /section/:sectionId                   │ admin, coordinator,      │
 * │        │                                       │ teacher                  │
 * │ GET    │ /section/:sectionId/summary           │ admin, coordinator,      │
 * │        │                                       │ teacher                  │
 * │ GET    │ /student/:studentId                   │ admin, coordinator,      │
 * │        │                                       │ teacher, parent          │
 * │ GET    │ /student/:studentId/summary           │ admin, coordinator,      │
 * │        │                                       │ teacher, parent          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Fine-grained section/student-level checks are done inside the controllers
 * (homeroom vs. subject teacher, parent-owns-student, etc.) using the
 * helpers in access.middleware.ts.
 */

import express from 'express'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { roleMiddleware } from '../middlewares/role.middleware.js'
import {
  upsertSectionAttendance,
  getSchoolDay,
  getSectionAttendanceForDate,
  getStudentAttendance,
  getSectionAttendanceRange,
  getStudentAttendanceSummary,
  getSectionAttendanceSummary,
} from '../controllers/attendance.controller.js'

const router = express.Router()

// ── School day lookup ────────────────────────────────────────────────────────
router.get(
  '/school-day',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  getSchoolDay
)

// ── Section-date attendance (write) ──────────────────────────────────────────
// POST: homeroom teacher, admin, coordinator
router.post(
  '/section/:sectionId/date/:date',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  upsertSectionAttendance
)

// ── Section-date attendance (read roster) ─────────────────────────────────────
// GET: any teacher assigned to section, admin, coordinator
router.get(
  '/section/:sectionId/date/:date',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  getSectionAttendanceForDate
)

// ── Section date-range read ───────────────────────────────────────────────────
// NOTE: /summary must come before /:sectionId to avoid route conflict
router.get(
  '/section/:sectionId/summary',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  getSectionAttendanceSummary
)

router.get(
  '/section/:sectionId',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher'),
  getSectionAttendanceRange
)

// ── Student attendance (read + summary) ───────────────────────────────────────
// parent role allowed; fine-grained check is in the controller
router.get(
  '/student/:studentId/summary',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher', 'parent'),
  getStudentAttendanceSummary
)

router.get(
  '/student/:studentId',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher', 'parent'),
  getStudentAttendance
)

export default router
