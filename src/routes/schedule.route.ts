import express from 'express'
import {
  getScheduleSettings,
  upsertScheduleSettings,
} from '../controllers/scheduleSetting.controller.js'
import {
  listWeeklyRequirements,
  bulkUpsertWeeklyRequirements,
  deleteWeeklyRequirement,
  copyWeeklyRequirements,
} from '../controllers/weeklyRequirement.controller.js'
import { getSchedulePrecheck } from '../controllers/schedulePrecheck.controller.js'
import {
  generateSchedule,
  getGenerationJob,
  listGenerationJobs,
} from '../controllers/scheduleGeneration.controller.js'
import {
  deleteSchedule,
  getDraftSchedule,
  getSchedule,
  getScheduleEntries,
  listSchedules,
} from '../controllers/scheduleRead.controller.js'
import {
  lockScheduleEntries,
  moveScheduleEntry,
  placeUnplacedLesson,
  removeScheduleEntry,
  swapScheduleEntries,
} from '../controllers/scheduleEdit.controller.js'
import {
  cloneScheduleController,
  getScheduleDrift,
  publishScheduleController,
} from '../controllers/scheduleLifecycle.controller.js'
import {
  getMySchedule,
  getPublishedSchedule,
  getSectionPublishedSchedule,
} from '../controllers/scheduleAccess.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { roleMiddleware } from '../middlewares/role.middleware.js'

const router = express.Router()

// ── Role-scoped reads of PUBLISHED schedules ────────────────────────────────
// Declared BEFORE the admin/coordinator guard below so they are reachable by
// teachers/parents. They only ever read `status: 'published'` documents.
router.get('/published', authMiddleware, roleMiddleware('admin', 'coordinator'), getPublishedSchedule)
router.get('/my', authMiddleware, roleMiddleware('teacher'), getMySchedule)
router.get(
  '/sections/:sectionId/published',
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher', 'parent'),
  getSectionPublishedSchedule
)

// Every other schedule endpoint is admin/coordinator only.
router.use(authMiddleware, roleMiddleware('admin', 'coordinator'))

// ── Settings (one per school year) ──────────────────────────────────────────
router.get('/settings', getScheduleSettings)
router.put('/settings', upsertScheduleSettings)

// ── Weekly period requirements (one per year + grade + subject) ─────────────
// NOTE: /requirements/copy must be declared before /requirements/:id so it is
// not captured as an id. copy is POST, :id is DELETE, so this is belt-and-braces.
router.post('/requirements/copy', copyWeeklyRequirements)
router.get('/requirements', listWeeklyRequirements)
router.put('/requirements', bulkUpsertWeeklyRequirements)
router.delete('/requirements/:id', deleteWeeklyRequirement)

// ── Precheck ────────────────────────────────────────────────────────────────
router.get('/precheck', getSchedulePrecheck)

// ── Generation ──────────────────────────────────────────────────────────────
router.post('/generate', generateSchedule)
router.get('/generation-jobs', listGenerationJobs)
router.get('/generation-jobs/:id', getGenerationJob)

// ── Schedule reads ──────────────────────────────────────────────────────────
// NOTE: /draft must be declared before /:id so it is not captured as an id.
// /schedules/:id/entries is declared before /schedules/:id (more specific path).
router.get('/schedules', listSchedules)
router.get('/draft', getDraftSchedule)
router.get('/schedules/:id/entries', getScheduleEntries)

// ── Draft edits (move / swap / remove / place) ──────────────────────────────
router.post('/schedules/:id/entries/swap', swapScheduleEntries)
router.post('/schedules/:id/entries/:entryId/move', moveScheduleEntry)
router.post('/schedules/:id/entries/:entryId/remove', removeScheduleEntry)
router.post('/schedules/:id/unplaced/place', placeUnplacedLesson)

// ── Locking ─────────────────────────────────────────────────────────────────
router.post('/schedules/:id/lock', lockScheduleEntries)

// ── Lifecycle: publish / clone / drift ──────────────────────────────────────
router.post('/schedules/:id/publish', publishScheduleController)
router.post('/schedules/:id/clone', cloneScheduleController)
router.get('/schedules/:id/drift', getScheduleDrift)

router.get('/schedules/:id', getSchedule)
router.delete('/schedules/:id', deleteSchedule)

export default router
