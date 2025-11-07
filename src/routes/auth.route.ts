import express from 'express'
import {
  signupUser,
  loginUser,
  getCurrentUser
} from '../controllers/authentication/auth.controller.ts'
import { authMiddleware } from '../middlewares/auth.middleware.ts'
import { sendVerification } from '../controllers/authentication/auth.controller.ts'

const router = express.Router()

router.post('/sendVerification', sendVerification)
router.post('/signup', signupUser)
router.post('/signin', loginUser)


router.get('/me', authMiddleware, getCurrentUser)

export default router
