import express from 'express'
import {
  createAssessmentType,
  getAllAssessmentTypes,
  getAssessmentTypeById,
  updateAssessmentType,
  deleteAssessmentType
} from '../../controllers/assessment/assessmentType.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { roleMiddleware } from '../../middlewares/role.middleware'

const router = express.Router()

router.get('/', authMiddleware, getAllAssessmentTypes)
router.get('/:id', authMiddleware, getAssessmentTypeById)

//  (admin/coordinator only)
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createAssessmentType)
router.put('/:id', authMiddleware, roleMiddleware('admin', 'coordinator') ,updateAssessmentType)
router.delete('/:id', authMiddleware,roleMiddleware('admin', 'coordinator'), deleteAssessmentType)


export default router