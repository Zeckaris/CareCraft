import { Request, Response, NextFunction } from 'express';
import { InviteToken } from '../models/inviteToken.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';

export const createInviteTokenMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const { role, studentId, tokenId } = req.body;

  // If tokenId provided, skip creation (for resend)
  if (tokenId) return next();

  if (!role) {
    sendResponse(res, 400, false, 'Missing fields: role.');
    return;
  }

  if (role === 'parent' && !studentId) {
    sendResponse(res, 400, false, 'Missing fields: parent needs studentId.');
    return;
  }

  try {
    // --- Generate 6-digit numeric OTP ---
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const newToken = await new InviteToken({
      token: otp,
      role: role.toLowerCase(),
      createdFor: role === 'parent' ? studentId : null,
      expiresAt: new Date(Date.now() + 3 * 60 * 1000), // 3 minutes
      isUsed: false,
    }).save();

    (req as any).inviteToken = newToken;
    next();
  } catch (error) {
    sendResponse(res, 500, false, 'OTP creation failed.', null, error);
  }
};
