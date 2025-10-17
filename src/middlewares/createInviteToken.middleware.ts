import { Request, Response, NextFunction } from 'express';
import { InviteToken } from '../models/inviteToken.model';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'defaultsecret';

export const createInviteTokenMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const { role, studentId, tokenId } = req.body;

  // If tokenId provided, skip creation (for resend)
  if (tokenId) return next();

  if (!role || (role === 'parent' && !studentId)) {
    return res.status(400).json({ message: 'Missing fields: parent needs studentId.' });
  }

  try {
    const payload: any = { role: role.toLowerCase() };
    if (role === 'parent') payload.studentId = studentId;

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: 180 }); // 3 min

    const newToken = await new InviteToken({
      token,
      role: role.toLowerCase(),
      createdFor: role === 'parent' ? studentId : null, 
      expiresAt: new Date(Date.now() + 180000),
    }).save();

    (req as any).inviteToken = newToken;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Token creation failed.' });
  }
};