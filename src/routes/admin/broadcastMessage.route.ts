import express from 'express'
import {
  createBroadcast,
  updateBroadcast,
  deleteBroadcast,
  getAllBroadcasts,
  getBroadcastById,
  getDraftBroadcasts
} from '../../controllers/admin/broadcastMessage.controller.ts'
import { authMiddleware } from '../../middlewares/auth.middleware.ts'
import { roleMiddleware } from '../../middlewares/role.middleware.ts'

const router = express.Router()


router.get('/', authMiddleware,roleMiddleware('admin', 'coordinator'), getAllBroadcasts)

router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), getBroadcastById)
router.get('/drafts', authMiddleware, roleMiddleware('admin'), getDraftBroadcasts)


router.post('/', authMiddleware,roleMiddleware('admin'), createBroadcast)
router.put('/:id', authMiddleware, roleMiddleware('admin'),updateBroadcast)
router.delete('/:id', authMiddleware, roleMiddleware('admin'),deleteBroadcast)

export default router
