import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ActionPlan } from '../models/actionPlan.model.ts';
import { Student } from '../models/student.model.ts';
import  UserAccount  from '../models/userAccount.model.ts';
import { BadgeCriteria } from '../models/badgeCriteria.model.ts';
import { sendResponse } from '../utils/sendResponse.util.ts'

export const getAllActionPlans = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, teacherId, startDate, endDate } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (teacherId) {
    if (!mongoose.isValidObjectId(teacherId)) {
      sendResponse(res, 400, false, 'Invalid teacherId');
      return;
    }
    const user = await UserAccount.findById(teacherId);
    if (!user || !['admin', 'teacher'].includes(user.role)) {
      sendResponse(res, 400, false, 'Invalid teacherId: User does not exist or lacks required role');
      return;
    }
    filter.teacherId = teacherId;
  }
  if (startDate) {
    const date = new Date(startDate as string);
    if (isNaN(date.getTime())) {
      sendResponse(res, 400, false, 'Invalid startDate');
      return;
    }
    filter.startDate = { $gte: date };
  }
  if (endDate) {
    const date = new Date(endDate as string);
    if (isNaN(date.getTime())) {
      sendResponse(res, 400, false, 'Invalid endDate');
      return;
    }
    filter.endDate = { $lte: date };
  }

  try {
    const plans = await ActionPlan.find(filter)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean({ virtuals: true });
    const total = await ActionPlan.countDocuments(filter);

    sendResponse(res, 200, true, 'Action plans fetched successfully', plans, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching action plans: ${(error as Error).message}`, null, error);
  }
};

export const getActionPlansByStudent = async (req: Request, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { page = 1, limit = 10, startDate, endDate } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }
  const student = await Student.findById(studentId);
  if (!student) {
    sendResponse(res, 404, false, 'Student not found');
    return;
  }

  const filter: any = { studentId };
  if (startDate) {
    const date = new Date(startDate as string);
    if (isNaN(date.getTime())) {
      sendResponse(res, 400, false, 'Invalid startDate');
      return;
    }
    filter.startDate = { $gte: date };
  }
  if (endDate) {
    const date = new Date(endDate as string);
    if (isNaN(date.getTime())) {
      sendResponse(res, 400, false, 'Invalid endDate');
      return;
    }
    filter.endDate = { $lte: date };
  }

  try {
    const plans = await ActionPlan.find(filter)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean({ virtuals: true });
    const total = await ActionPlan.countDocuments(filter);

    sendResponse(res, 200, true, 'Student action plans fetched successfully', plans, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching action plans: ${(error as Error).message}`, null, error);
  }
};

export const getActionPlansByTeacher = async (req: Request, res: Response): Promise<void> => {
  const { teacherId } = req.params;
  const { page = 1, limit = 10, studentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId');
    return;
  }
  const user = await UserAccount.findById(teacherId);
  if (!user || !['admin', 'teacher'].includes(user.role)) {
    sendResponse(res, 400, false, 'Invalid teacherId: User does not exist or lacks required role');
    return;
  }

  const filter: any = { teacherId };
  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      sendResponse(res, 400, false, 'Invalid studentId');
      return;
    }
    const student = await Student.findById(studentId);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found');
      return;
    }
    filter.studentId = studentId;
  }

  try {
    const plans = await ActionPlan.find(filter)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean({ virtuals: true });
    const total = await ActionPlan.countDocuments(filter);

    sendResponse(res, 200, true, 'Teacher action plans fetched successfully', plans, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching action plans: ${(error as Error).message}`, null, error);
  }
};

export const getActionPlanById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid action plan ID');
    return;
  }

  try {
    const plan = await ActionPlan.findById(id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean({ virtuals: true });
    if (!plan) {
      sendResponse(res, 404, false, 'ActionPlan not found');
      return;
    }
    sendResponse(res, 200, true, 'Action plan fetched successfully', plan);
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching action plan: ${(error as Error).message}`, null, error);
  }
};

export const createActionPlan = async (req: Request, res: Response): Promise<void> => {
  const { studentId, teacherId, issue, goal, actionSteps, startDate, endDate } = req.body;

  // Validate required fields
  if (!studentId || !teacherId || !issue || !goal || !actionSteps || !Array.isArray(actionSteps) || actionSteps.length === 0 || !startDate || !endDate) {
    sendResponse(res, 400, false, 'Missing required fields: studentId, teacherId, issue, goal, actionSteps (non-empty array), startDate, or endDate');
    return;
  }

  // Validate IDs
  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }
  if (!mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId');
    return;
  }

  // Validate strings
  if (typeof issue !== 'string' || issue.trim().length < 5 || issue.trim().length > 500) {
    sendResponse(res, 400, false, 'Invalid issue: Must be 5–500 characters');
    return;
  }
  if (typeof goal !== 'string' || goal.trim().length < 5 || goal.trim().length > 500) {
    sendResponse(res, 400, false, 'Invalid goal: Must be 5–500 characters');
    return;
  }

  // Validate actionSteps structure
  if (!actionSteps.every((item: any) => 
    item && 
    typeof item.step === 'string' && 
    item.step.trim().length >= 5 && 
    item.step.trim().length <= 500 &&
    (item.completed === undefined || typeof item.completed === 'boolean')
  )) {
    sendResponse(res, 400, false, 'Invalid actionSteps: Each must have step (5–500 chars) and optional completed (boolean)');
    return;
  }

  // Validate dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    sendResponse(res, 400, false, 'Invalid startDate or endDate');
    return;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (start < today) {
    sendResponse(res, 400, false, 'startDate must be today or in the future');
    return;
  }
  const maxEndDate = new Date(start);
  maxEndDate.setMonth(maxEndDate.getMonth() + 6);
  if (end > maxEndDate) {
    sendResponse(res, 400, false, 'endDate must be within 6 months of startDate');
    return;
  }
  if (end < start) {
    sendResponse(res, 400, false, 'endDate must be on or after startDate');
    return;
  }

  try {
    // Validate references
    const student = await Student.findById(studentId);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found');
      return;
    }
    const user = await UserAccount.findById(teacherId);
    if (!user || !['admin', 'teacher'].includes(user.role)) {
      sendResponse(res, 400, false, 'Invalid teacherId: User does not exist or lacks required role (admin, teacher)');
      return;
    }

    // Check duplicate issue for student
    const existingPlan = await ActionPlan.findOne({ studentId, issue: issue.trim() });
    if (existingPlan) {
      sendResponse(res, 400, false, 'An action plan for this student and issue already exists');
      return;
    }

    const actionPlan = await ActionPlan.create({
      studentId,
      teacherId,
      issue: issue.trim(),
      goal: goal.trim(),
      actionSteps: actionSteps.map((item: any) => ({
        step: item.step.trim(),
        completed: item.completed || false
      })),
      startDate: start,
      endDate: end
    });

    const populated = await ActionPlan.findById(actionPlan._id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean({ virtuals: true });
    sendResponse(res, 201, true, 'Action plan created successfully', populated);
  } catch (error) {
    sendResponse(res, 500, false, `Server error creating action plan: ${(error as Error).message}`, null, error);
  }
};


export const updateActionPlan = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { studentId, teacherId, issue, goal, actionSteps, startDate, endDate } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid action plan ID');
    return;
  }
  if (!studentId && !teacherId && !issue && !goal && !actionSteps && !startDate && !endDate) {
    sendResponse(res, 400, false, 'At least one field required for update');
    return;
  }

  try {
    const actionPlan = await ActionPlan.findById(id);
    if (!actionPlan) {
      sendResponse(res, 404, false, 'ActionPlan not found');
      return;
    }

    // Validate inputs if provided
    if (studentId) {
      if (!mongoose.isValidObjectId(studentId)) {
        sendResponse(res, 400, false, 'Invalid studentId');
        return;
      }
      const student = await Student.findById(studentId);
      if (!student) {
        sendResponse(res, 404, false, 'Student not found');
        return;
      }
    }
    if (teacherId) {
      if (!mongoose.isValidObjectId(teacherId)) {
        sendResponse(res, 400, false, 'Invalid teacherId');
        return;
      }
      const user = await UserAccount.findById(teacherId);
      if (!user || !['admin', 'teacher'].includes(user.role)) {
        sendResponse(res, 400, false, 'Invalid teacherId: User does not exist or lacks required role');
        return;
      }
    }
    if (issue && (typeof issue !== 'string' || issue.trim().length < 5 || issue.trim().length > 500)) {
      sendResponse(res, 400, false, 'Invalid issue: Must be 5–500 characters');
      return;
    }
    if (goal && (typeof goal !== 'string' || goal.trim().length < 5 || goal.trim().length > 500)) {
      sendResponse(res, 400, false, 'Invalid goal: Must be 5–500 characters');
      return;
    }
    if (actionSteps) {
      if (!Array.isArray(actionSteps) || actionSteps.length === 0 || !actionSteps.every((item: any) => 
        item && 
        typeof item.step === 'string' && 
        item.step.trim().length >= 5 && 
        item.step.trim().length <= 500 &&
        (item.completed === undefined || typeof item.completed === 'boolean')
      )) {
        sendResponse(res, 400, false, 'Invalid actionSteps: Each must have step (5–500 chars) and optional completed (boolean)');
        return;
      }
    }
    if (startDate) {
      const start = new Date(startDate);
      if (isNaN(start.getTime())) {
        sendResponse(res, 400, false, 'Invalid startDate');
        return;
      }
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (start < today) {
        sendResponse(res, 400, false, 'startDate must be today or in the future');
        return;
      }
    }
    if (endDate) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        sendResponse(res, 400, false, 'Invalid endDate');
        return;
      }
      const start = startDate ? new Date(startDate) : actionPlan.startDate;
      const maxEndDate = new Date(start);
      maxEndDate.setMonth(maxEndDate.getMonth() + 6);
      if (end > maxEndDate) {
        sendResponse(res, 400, false, 'endDate must be within 6 months of startDate');
        return;
      }
      if (end < start) {
        sendResponse(res, 400, false, 'endDate must be on or after startDate');
        return;
      }
    }

    // Check duplicate issue if changing student or issue
    if ((studentId && studentId !== actionPlan.studentId.toString()) || (issue && issue.trim() !== actionPlan.issue)) {
      const existingPlan = await ActionPlan.findOne({
        studentId: studentId || actionPlan.studentId,
        issue: issue ? issue.trim() : actionPlan.issue
      });
      if (existingPlan && existingPlan._id.toString() !== id) {
        sendResponse(res, 400, false, 'An action plan for this student and issue already exists');
        return;
      }
    }

    const updateData: any = {};
    if (studentId) updateData.studentId = studentId;
    if (teacherId) updateData.teacherId = teacherId;
    if (issue) updateData.issue = issue.trim();
    if (goal) updateData.goal = goal.trim();
    if (actionSteps) {
      updateData.actionSteps = actionSteps.map((item: any) => ({
        step: item.step.trim(),
        completed: item.completed ?? false
      }));
    }
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate) updateData.endDate = new Date(endDate);

    const updated = await ActionPlan.findByIdAndUpdate(id, updateData, { new: true })
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean({ virtuals: true });
    
    sendResponse(res, 200, true, 'Action plan updated successfully', updated);
  } catch (error) {
    sendResponse(res, 500, false, `Server error updating action plan: ${(error as Error).message}`, null, error);
  }
};

export const updateActionPlanStep = async (req: Request, res: Response): Promise<void> => {
  const { id, stepIndex } = req.params;
  const { step, completed } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid action plan ID');
    return;
  }
  const index = Number(stepIndex);
  if (isNaN(index) || index < 0) {
    sendResponse(res, 400, false, 'Invalid stepIndex: Must be a non-negative number');
    return;
  }
  if (step !== undefined && (typeof step !== 'string' || step.trim().length < 5 || step.trim().length > 500)) {
    sendResponse(res, 400, false, 'Invalid step: Must be 5–500 characters if provided');
    return;
  }
  if (completed !== undefined && typeof completed !== 'boolean') {
    sendResponse(res, 400, false, 'Invalid completed: Must be a boolean if provided');
    return;
  }
  if (step === undefined && completed === undefined) {
    sendResponse(res, 400, false, 'At least one field (step, completed) required for update');
    return;
  }

  try {
    const actionPlan = await ActionPlan.findById(id);
    if (!actionPlan) {
      sendResponse(res, 404, false, 'ActionPlan not found');
      return;
    }
    if (index >= actionPlan.actionSteps.length) {
      sendResponse(res, 400, false, 'Invalid stepIndex: Out of range for actionSteps array');
      return;
    }

    if (step !== undefined) {
      actionPlan.actionSteps[index].step = step.trim();
    }
    if (completed !== undefined) {
      actionPlan.actionSteps[index].completed = completed;
    }

    await actionPlan.save();

    const updated = await ActionPlan.findById(id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean({ virtuals: true });
    sendResponse(res, 200, true, 'Action plan step updated successfully', updated);
  } catch (error) {
    sendResponse(res, 500, false, `Server error updating action plan step: ${(error as Error).message}`, null, error);
  }
};


export const deleteActionPlan = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid action plan ID');
    return;
  }

  try {
    const actionPlan = await ActionPlan.findById(id);
    if (!actionPlan) {
      sendResponse(res, 404, false, 'ActionPlan not found');
      return;
    }

    // Check if linked to BadgeCriteria
    const dependentCriteria = await BadgeCriteria.findOne({ actionPlanId: id });
    if (dependentCriteria) {
      sendResponse(res, 400, false, 'Cannot delete action plan: It is linked to badge criteria');
      return;
    }

    await ActionPlan.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Action plan deleted successfully');
  } catch (error) {
    sendResponse(res, 500, false, `Server error deleting action plan: ${(error as Error).message}`, null, error);
  }
};