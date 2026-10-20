import express from 'express'
import {
  getAllObservations,
  getObservationById,
  createObservation,
  updateObservation,
  deleteObservation,
  bulkDeleteObservationsByStudent,
} from '../controllers/observation.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { roleMiddleware } from '../middlewares/role.middleware.js'
import { requireFeatureForRoles } from '../middlewares/feature.middleware.js'

const router = express.Router()

router.use(
  authMiddleware,
  roleMiddleware('admin', 'coordinator', 'teacher', 'parent'),
  requireFeatureForRoles('observations', ['teacher', 'parent'])
)

router.get('/', getAllObservations)
router.post('/', roleMiddleware('teacher'), createObservation)

router.delete(
  '/student/:studentId',
  roleMiddleware('admin', 'coordinator'),
  bulkDeleteObservationsByStudent
)

router.get('/:id', getObservationById)
router.put('/:id', roleMiddleware('teacher'), updateObservation)
router.delete('/:id', roleMiddleware('admin', 'coordinator', 'teacher'), deleteObservation)

export default router
