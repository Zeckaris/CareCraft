import express from 'express'
import {
  createAssessmentSetup,
  getAllAssessmentSetups,
  getAssessmentSetupById,
  updateAssessmentSetup,
  deleteAssessmentSetup
} from '../../controllers/assessment/assessmentSetup.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import {roleMiddleware} from '../../middlewares/role.middleware'

const router = express.Router()

// available for admin, coordinator and teacher
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getAllAssessmentSetups)
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher') ,getAssessmentSetupById)

//available for admin and coordinator only
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator') ,createAssessmentSetup)
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'),  updateAssessmentSetup)
router.delete('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'),deleteAssessmentSetup)

export default router