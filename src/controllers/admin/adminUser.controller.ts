import { Request, Response } from 'express';
import UserAccount from '../../models/userAccount.model';

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: 'admin' | 'teacher' | 'parent' | 'student' | 'coordinator' };
}

export const getAllTeachers = async (req: AuthRequest, res: Response) => {
  try {
    console.log('Get all teachers - User:', req.user);
    const teachers = await UserAccount.find({ role: 'teacher' }).select(
      'firstName lastName email phoneNumber lastLogin createdAt updatedAt'
    );
    res.status(200).json({ data: teachers });
  } catch (error) {
    console.error('Get all teachers error:', error);
    res.status(500).json({ error: `Server error: ${(error as Error).message}` });
  }
};

export const getAllParents = async (req: AuthRequest, res: Response) => {
  try {
    console.log('Get all parents - User:', req.user);
    const parents = await UserAccount.find({ role: 'parent' }).select(
      'firstName lastName email phoneNumber lastLogin createdAt updatedAt'
    );
    res.status(200).json({ data: parents });
  } catch (error) {
    console.error('Get all parents error:', error);
    res.status(500).json({ error: `Server error: ${(error as Error).message}` });
  }
};