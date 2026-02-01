import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../utils/auth.util.js'
import { Types } from 'mongoose';
import UserAccount from '../models/userAccount.model.js'

export interface AuthRequest extends Request {
  user?: {
    id: string | Types.ObjectId;
    email: string;
    role: string;
    firstName: string;
  };
}

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies?.jwt;
    if (!token) return res.status(401).json({ message: 'No token provided. Unauthorized.' });

    const decoded = verifyToken(token);

    const user = await UserAccount.findById(decoded.id);
    if (!user) return res.status(401).json({ message: 'User not found. Unauthorized.' });
    if (user.isSuspended) return res.status(403).json({ message: 'Account is suspended.' });


    req.user = {
      id: user._id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
    };

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token. Unauthorized.' });
  }
};
