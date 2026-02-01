import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model.js';
import { sendResponse } from '../../utils/sendResponse.util.js';

interface AuthRequest extends Request {
  user?: { role: string };
}

// Search users for suspension management
export const searchUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {

    const { q = '', role } = req.query;

    if (typeof q !== 'string') {
      sendResponse(res, 400, false, 'Invalid search query.');
      return;
    }

    const searchTerm = q.trim();
    if (searchTerm.length < 2) {
      sendResponse(res, 200, true, 'Search term too short.', []);
      return;
    }

    // Build query
    const query: any = {
      role: { $ne: 'admin' }, // Exclude admins
      $or: [
        { firstName: { $regex: searchTerm, $options: 'i' } },
        { lastName: { $regex: searchTerm, $options: 'i' } },
        { 
          $expr: { 
            $regexMatch: { 
              input: { $concat: ["$firstName", " ", "$lastName"] }, 
              regex: searchTerm, 
              options: "i" 
            } 
          } 
        },
      ],
    };

    // Optional role filter (teacher, coordinator, parent)
    if (role && typeof role === 'string' && ['teacher', 'coordinator', 'parent'].includes(role)) {
      query.role = role;
    }

    const users = await UserAccount.find(query)
      .select('_id firstName lastName role isSuspended')
      .limit(20)
      .lean();

    const formattedUsers = users.map(user => ({
      id: user._id,
      fullName: `${user.firstName} ${user.lastName}`,
      role: user.role,
      isSuspended: user.isSuspended,
    }));

    sendResponse(res, 200, true, 'Users found.', formattedUsers);
  } catch (error) {
    console.error('User search error:', error);
    sendResponse(res, 500, false, 'Failed to search users.');
  }
};