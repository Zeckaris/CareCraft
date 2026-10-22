import express from 'express'
import multer from 'multer'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { roleMiddleware } from '../middlewares/role.middleware.js'
import {
  getAllGifts,
  getGiftOptions,
  getGiftById,
  createGift,
  updateGift,
  deleteGift,
} from '../controllers/gift.controller.js'

const router = express.Router()
const memoryUpload = multer({ storage: multer.memoryStorage() })

router.use(authMiddleware, roleMiddleware('admin', 'coordinator'))

router.get('/', getAllGifts)
router.get('/options', getGiftOptions)
router.get('/:id', getGiftById)

router.post('/', memoryUpload.single('image'), createGift)
router.put('/:id', memoryUpload.single('image'), updateGift)
router.delete('/:id', deleteGift)

export default router
