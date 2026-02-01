import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model.js';
import { sendResponse } from '../../utils/sendResponse.util.js';

// Extend Request to include authenticated user from authMiddleware
interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// Toggle MFA for the current user 
export const toggleMfa = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { mfaEnabled } = req.body;

    if (userId === undefined || mfaEnabled === undefined || typeof mfaEnabled !== 'boolean') {
      sendResponse(res, 400, false, 'Invalid request data.');
      return;
    }

    const user = await UserAccount.findById(userId);
    if (!user) {
      sendResponse(res, 404, false, 'User not found.');
      return;
    }

    // Only allow the user to toggle their own MFA
    user.mfaEnabled = mfaEnabled;
    await user.save();

    sendResponse(res, 200, true, `MFA ${mfaEnabled ? 'enabled' : 'disabled'} successfully.`, {
      mfaEnabled: user.mfaEnabled,
    });
  } catch (error) {
    console.error('Toggle MFA error:', error);
    sendResponse(res, 500, false, 'Failed to update MFA setting.');
  }
};

// Suspend a user (admin only)
export const suspendUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminId = req.user?.id;
    const adminRole = req.user?.role;
    const { userId } = req.params;
    const { suspensionReason } = req.body; // optional

    if (adminRole !== 'admin') {
      sendResponse(res, 403, false, 'Only admins can suspend users.');
      return;
    }

    if (!userId) {
      sendResponse(res, 400, false, 'User ID is required.');
      return;
    }

    // Prevent self-suspension
    if (userId === adminId) {
      sendResponse(res, 400, false, 'You cannot suspend your own account.');
      return;
    }

    const userToSuspend = await UserAccount.findById(userId);
    if (!userToSuspend) {
      sendResponse(res, 404, false, 'User not found.');
      return;
    }

    if (userToSuspend.isSuspended) {
      sendResponse(res, 400, false, 'User is already suspended.');
      return;
    }

    userToSuspend.isSuspended = true;
    userToSuspend.suspendedAt = new Date();
    userToSuspend.suspendedBy = adminId;
    if (suspensionReason && typeof suspensionReason === 'string') {
      userToSuspend.suspensionReason = suspensionReason.trim();
    }

    await userToSuspend.save();

    sendResponse(res, 200, true, 'User suspended successfully.', {
      userId: userToSuspend._id,
      isSuspended: true,
    });
  } catch (error) {
    console.error('Suspend user error:', error);
    sendResponse(res, 500, false, 'Failed to suspend user.');
  }
};

// Unsuspend a user (admin only)
export const unsuspendUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const adminRole = req.user?.role;
    const { userId } = req.params;

    if (adminRole !== 'admin') {
      sendResponse(res, 403, false, 'Only admins can unsuspend users.');
      return;
    }

    if (!userId) {
      sendResponse(res, 400, false, 'User ID is required.');
      return;
    }

    const userToUnsuspend = await UserAccount.findById(userId);
    if (!userToUnsuspend) {
      sendResponse(res, 404, false, 'User not found.');
      return;
    }

    if (!userToUnsuspend.isSuspended) {
      sendResponse(res, 400, false, 'User is not suspended.');
      return;
    }

    userToUnsuspend.isSuspended = false;
    userToUnsuspend.suspendedAt = null;
    userToUnsuspend.suspendedBy = null;
    userToUnsuspend.suspensionReason = null;

    await userToUnsuspend.save();

    sendResponse(res, 200, true, 'User unsuspended successfully.', {
      userId: userToUnsuspend._id,
      isSuspended: false,
    });
  } catch (error) {
    console.error('Unsuspend user error:', error);
    sendResponse(res, 500, false, 'Failed to unsuspend user.');
  }
};