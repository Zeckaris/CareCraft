import express from 'express'
import {
  signupUser,
  loginUser,
  getCurrentUser,
  signout
} from '../controllers/authentication/auth.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js'
import { sendVerification } from '../controllers/authentication/auth.controller.js'

const router = express.Router()

router.post('/sendVerification', sendVerification)
router.post('/signup', signupUser)
router.post('/signin', loginUser)
router.post('/signout', signout)


router.get('/me', authMiddleware, getCurrentUser)

export default router
