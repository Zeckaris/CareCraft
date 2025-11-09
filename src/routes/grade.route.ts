import express from 'express'
import {
  createGrade,
  getAllGrades,
  getGradeById,
  deleteGrade,
  updateGrade
} from '../controllers/admin/grade.controller.ts' 
import { authMiddleware} from '../middlewares/auth.middleware.ts' 
import { roleMiddleware } from '../middlewares/role.middleware.ts'

const router = express.Router()


router.get('/', getAllGrades)

// POST create grade (admin only)
router.post('/', authMiddleware, roleMiddleware('admin'), createGrade)

router.get('/:id', getGradeById)
router.put('/:id', authMiddleware, roleMiddleware('admin'), updateGrade);
router.delete('/:id', authMiddleware,  roleMiddleware('admin'), deleteGrade)

export default router