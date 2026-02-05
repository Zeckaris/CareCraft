import { Request, Response } from 'express';
import { InviteToken } from '../../models/inviteToken.model.js';  
import jwt from 'jsonwebtoken';
import { sendInviteEmail, validateEmail } from '../../utils/emailVerification.util.js';
import { sendResponse } from '../../utils/sendResponse.util.js'

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'defaultsecret';


const isAdminOrCoordinator = (req: Request): boolean => {
    const userRole = (req as any).user?.role;
    return userRole === 'admin' || userRole === 'coordinator';
};



// Transformed createInviteToken in to middleware and sent it there to make creating and sending tokens streamlined


export const sendInvite = async (req: Request, res: Response): Promise<void> => {
  const { targetEmail, role, tokenId } = req.body;

  if (!targetEmail || !role) {
    sendResponse(res, 400, false, 'targetEmail and role required.');
    return;
  }

  if (!validateEmail(targetEmail)) {
    sendResponse(res, 400, false, 'Invalid email format.');
    return;
  }

  try {
    // Get token (from middleware or existing)
    const tokenRecord = tokenId
      ? await InviteToken.findById(tokenId)
      : (req as any).inviteToken;

    if (!tokenRecord) {
      sendResponse(res, 404, false, 'Token not found.');
      return;
    }

    // Send **OTP** in email instead of JWT
    await sendInviteEmail(targetEmail, tokenRecord.token, role);

    sendResponse(res, 200, true, `${role} invite sent to ${targetEmail}!`, {
      tokenId: tokenRecord._id
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Failed to send invite.', null, error);
    return;
  }
};



export const getInviteTokens = async (req: Request, res: Response) => {
    if (!isAdminOrCoordinator(req)) {
        sendResponse(res, 403, false, 'Forbidden. Only admin or coordinator can view tokens.')
        return;
    }

    try {

      const page = parseInt(req.query.page as string) || 1;
        let limit = parseInt(req.query.limit as string) || 10;
        limit = Math.min(limit, 50); // Max 50 per page
        const skip = (page - 1) * limit;

        const total = await InviteToken.countDocuments();

        const tokens = await InviteToken.find().sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        sendResponse(res, 200, true, 'Invite tokens fetched successfully.', tokens, null, {
            total,
            page,
            limit
        })
    } catch (error) {
        sendResponse(res, 500, false, 'Server error fetching invite tokens.', null, error)
        return;
    }
};


export const deleteInviteToken = async (req: Request, res: Response) => {
    if (!isAdminOrCoordinator(req)) {
        sendResponse(res, 403, false, 'Forbidden. Only admin or coordinator can delete tokens.')
        return;
    }

    const { id } = req.params;

    try {
        const token = await InviteToken.findByIdAndDelete(id);
        if (!token) {
            sendResponse(res, 404, false, 'Invite token not found.')
            return;
        }
        sendResponse(res, 200, true, 'Invite token deleted successfully.')
    } catch (error) {
        sendResponse(res, 500, false, 'Server error deleting invite token.', null, error)
        return;
    }
};
