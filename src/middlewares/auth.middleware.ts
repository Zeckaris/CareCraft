import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../utils/auth.util.ts'
import { Types } from 'mongoose';

export interface AuthRequest extends Request {
  user?: {
    id: string | Types.ObjectId;
    email: string;
    role: string;
    firstName: string;
  };
}

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.jwt;
    if (!token) {
      return res.status(401).json({ message: 'No token provided. Unauthorized.' });
    }
    const decoded = verifyToken(token)
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      firstName: decoded.firstName,
    };

    next()
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token. Unauthorized.' })
  }
}
