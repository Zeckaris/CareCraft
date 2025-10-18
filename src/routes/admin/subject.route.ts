import express from 'express'
import {
  createSubject,
  getAllSubjects,
  getSubjectById,
  updateSubject,
  deleteSubject
} from '../../controllers/admin/subject.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { roleMiddleware } from '../../middlewares/role.middleware'

const router = express.Router()

router.get('/', getAllSubjects)

// create subject (admin only)
router.post('/', authMiddleware,roleMiddleware('admin'), createSubject)

router.get('/:id', getSubjectById)

router.put('/:id', authMiddleware, roleMiddleware('admin'), updateSubject)

router.delete('/:id', authMiddleware,roleMiddleware('admin'), deleteSubject)

export default router