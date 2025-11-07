import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model.ts';
import { sendResponse } from '../../utils/sendResponse.util.ts';

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: 'admin' | 'teacher' | 'parent' | 'student' | 'coordinator' };
}

export const getAllTeachers = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1; // <-- default page = 1
    const limit = 10;
    const skip = (page - 1) * limit;

    const total = await UserAccount.countDocuments({ role: 'teacher' });

    const teachers = await UserAccount.find({ role: 'teacher' }).select(
      'firstName lastName email phoneNumber lastLogin createdAt updatedAt'
    );

    sendResponse(res, 200, true, 'Teachers fetched successfully.', teachers, {
      total,
      page,
      limit,
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`);
  }
};


export const getAllParents = async (req: AuthRequest, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1; // <-- default page = 1
    const limit = 10;
    const skip = (page - 1) * limit;
    const total = await UserAccount.countDocuments({ role: 'parent' });


    const parents = await UserAccount.find({ role: 'parent' }).select(
      'firstName lastName email phoneNumber lastLogin createdAt updatedAt'
    );

    sendResponse(res, 200, true, 'Parents fetched successfully.', parents, {
      total,
      page,
      limit,
    });

  } catch (error) {
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`);
  }
};