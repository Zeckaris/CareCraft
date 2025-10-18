import express from 'express'
import {
  createGrade,
  getAllGrades,
  getGradeById,
  deleteGrade
} from '../controllers/admin/grade.controller' 
import { authMiddleware} from '../middlewares/auth.middleware' 
import { roleMiddleware } from '../middlewares/role.middleware'

const router = express.Router()


router.get('/', getAllGrades)

// POST create grade (admin only)
router.post('/', authMiddleware, roleMiddleware('admin'), createGrade)

router.get('/:id', getGradeById)
router.delete('/:id', authMiddleware,  roleMiddleware('admin'), deleteGrade)

export default router