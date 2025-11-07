import { Request, Response, NextFunction } from 'express';
import { InviteToken } from '../models/inviteToken.model.ts';
import jwt from 'jsonwebtoken';
import {sendResponse} from '../utils/sendResponse.util.ts'

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'defaultsecret';

export const createInviteTokenMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const { role, studentId, tokenId } = req.body;

  // If tokenId provided, skip creation (for resend)
  if (tokenId) return next();

  if (!role){
    sendResponse(res, 400, false, 'Missing fields: role.');
    return;
  }

  if (role === 'parent' && !studentId) {
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
    sendResponse(res, 500, false, 'Token creation failed.', null, error);
  }
};