import { Request, Response } from 'express';
import { InviteToken } from '../models/inviteToken.model';
import jwt from 'jsonwebtoken';
import { createInviteTokenMiddleware } from '../middlewares/createInviteToken.middleware'
import { sendInviteEmail, validateEmail } from '../utils/emailVerification.util';

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'defaultsecret';


const isAdminOrCoordinator = (req: Request): boolean => {
    const userRole = (req as any).user?.role;
    return userRole === 'admin' || userRole === 'coordinator';
};



// Transformed createInviteToken in to middleware and sent it there to make creating and sending tokens streamlined


export const sendInvite = async (req: Request, res: Response) => {
  const { targetEmail, role, tokenId } = req.body;
  
  if (!targetEmail || !role) {
    return res.status(400).json({ message: 'targetEmail and role required.' });
  }

  if (!validateEmail(targetEmail)) {
    return res.status(400).json({ message: 'Invalid email format.' });
  }

  try {
    // Get token (from middleware or existing)
    const tokenRecord = tokenId 
      ? await InviteToken.findById(tokenId)
      : (req as any).inviteToken;

    if (!tokenRecord) {
      return res.status(404).json({ message: 'Token not found.' });
    }

    await sendInviteEmail(targetEmail, tokenRecord.token, role);
    
    res.status(200).json({ 
      success: true, 
      message: `${role} invite sent to ${targetEmail}!`,
      tokenId: tokenRecord._id 
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to send invite.' });
  }
};


export const getInviteTokens = async (req: Request, res: Response) => {
    if (!isAdminOrCoordinator(req)) {
        res.status(403).json({ message: 'Forbidden. Only admin or coordinator can view tokens.' });
        return;
    }

    try {
        const tokens = await InviteToken.find().sort({ createdAt: -1 });
        res.status(200).json({ tokens });
    } catch (error) {
        res.status(500).json({ message: 'Server error fetching invite tokens.', error });
    }
};


export const deleteInviteToken = async (req: Request, res: Response) => {
    if (!isAdminOrCoordinator(req)) {
        res.status(403).json({ message: 'Forbidden. Only admin or coordinator can delete tokens.' });
        return;
    }

    const { id } = req.params;

    try {
        const token = await InviteToken.findByIdAndDelete(id);
        if (!token) {
            res.status(404).json({ message: 'Invite token not found.' });
            return;
        }
        res.status(200).json({ message: 'Invite token deleted successfully.' });
    } catch (error) {
        res.status(500).json({ message: 'Server error deleting invite token.', error });
    }
};
