import { Request, Response, NextFunction } from 'express'

interface AuthRequest extends Request {
  user?: any
}


export const roleMiddleware = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const user = req.user

    // This is a safeguard; it should never happen if authMiddleware runs first
    if (!user) {
      return res.status(500).json({ message: 'Unexpected error: user data missing after auth.' })
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ message: 'Access denied: insufficient permissions.' })
    }

    next()
  }
}
