import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../utils/auth.util'

interface AuthRequest extends Request {
  user?: any
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided. Unauthorized.' })
    }

    const token = authHeader.split(' ')[1]
    const decoded = verifyToken(token)
    req.user = decoded

    next()
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token. Unauthorized.' })
  }
}
