// src/middlewares/templateOwnership.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { SharedPlanTemplate } from '../models/sharedPlanTemplate.model';
import { Student } from '../models/student.model';
import { ActionPlan } from '../models/actionPlan.model';

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: 'admin' | 'teacher' | 'parent' | 'student' | 'coordinator' };
}

export const templateOwnershipMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = req.user;
  const { id, actionPlanId } = req.params;

  if (!user || !user.id) {
    console.error('User not authenticated:', user);
    return res.status(401).json({ error: 'User not authenticated' });
  }

  try {
    if (req.path.includes('/from-action-plan')) {
      const actionPlan = await ActionPlan.findById(actionPlanId);
      if (!actionPlan) {
        return res.status(404).json({ error: 'ActionPlan not found' });
      }
      console.log('User ID:', user.id, 'Type:', typeof user.id);
      console.log('ActionPlan teacherId:', actionPlan.teacherId.toString(), 'Type:', typeof actionPlan.teacherId.toString());
      if (actionPlan.teacherId.toString() !== user.id) {
        return res.status(403).json({ error: 'Unauthorized to share this action plan' });
      }
    } else if (req.path.includes('/apply') || req.path.includes('/rate')) {
      const template = await SharedPlanTemplate.findById(id);
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      const { studentId, teacherId } = req.body;

      if (req.path.includes('/apply') && !studentId) {
        return res.status(400).json({ error: 'studentId is required for apply' });
      }

      // Only validate studentId for parent role
      if (user.role === 'parent' && req.path.includes('/rate')) {
        if (!studentId) {
          return res.status(400).json({ error: 'studentId is required for parent role' });
        }
        const student = await Student.findById(studentId);
        if (!student) {
          return res.status(400).json({ error: 'Invalid studentId' });
        }
        console.log('Student parentId:', student.parentId?.toString(), 'TeacherId:', teacherId, 'User ID:', user.id);
        const userId = new Types.ObjectId(user.id);
        if (teacherId && user.id !== teacherId && student.parentId && !student.parentId.equals(userId)) {
          return res.status(403).json({ error: 'Unauthorized: Not the teacher or parent of this student' });
        }
        const studentWithPlan = await Student.findOne({
          $or: [
            {
              _id: { $in: (await ActionPlan.find({ teacherId: userId, 'actionSteps.step': { $in: template.actionSteps.map(s => s.description) } })).map(p => p.studentId) },
            },
            {
              parentId: userId,
              _id: { $in: (await ActionPlan.find({ 'actionSteps.step': { $in: template.actionSteps.map(s => s.description) } })).map(p => p.studentId) },
            },
          ],
        });
        if (!studentWithPlan) {
          return res.status(403).json({ error: 'You must have applied this template to rate it' });
        }
      }
      // Admin and teacher roles skip studentId validation
    } else {
      const template = await SharedPlanTemplate.findById(id);
      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }
      if (template.createdBy.toString() !== user.id) {
        return res.status(403).json({ error: 'Unauthorized to modify this template' });
      }
    }
    next();
  } catch (error) {
    console.error('Template ownership middleware error:', error);
    res.status(500).json({ error: `Server error: ${(error as Error).message}` });
  }
};