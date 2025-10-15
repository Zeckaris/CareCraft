import express from 'express'
import {
  signupUser,
  loginUser,
  getCurrentUser
} from '../controllers/authentication/auth.controller'
import { authMiddleware } from '../middlewares/auth.middleware'

const router = express.Router()

router.post('/signup', signupUser)
router.post('/login', loginUser)


router.get('/me', authMiddleware, getCurrentUser)

export default router
