import { Response } from 'express';
import mongoose from 'mongoose';
import { ActionPlan } from '../models/actionPlan.model.js';
import { Student } from '../models/student.model.js';
import UserAccount from '../models/userAccount.model.js';
import { sendResponse } from '../utils/sendResponse.util.js'
import { AuthRequest } from '../middlewares/auth.middleware.js';
import {
  resolveTeacherId,
  assertTeacherCanWriteStudent,
  assertTeacherCanReadStudent,
  assertParentOwnsStudent,
  getTeacherSectionIds,
} from '../middlewares/access.middleware.js';
import { StudentEnrollment } from '../models/studentEnrollment.model.js';


const VALID_RESPONSIBLE_PARTIES = ['teacher', 'parent', 'either'] as const;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build filter for student access based on role */
async function buildStudentConstraint(req: AuthRequest): Promise<any> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return {}

  if (user.role === 'parent') {
    const myStudent = await Student.findOne({ parentId: user.id }).select('_id').lean()
    if (!myStudent) return { studentId: new mongoose.Types.ObjectId() } // no match
    return { studentId: myStudent._id }
  }

  if (user.role === 'teacher') {
    const sectionIds = await getTeacherSectionIds(user.id)
    const enrollments = await StudentEnrollment.find({
      sectionId: { $in: sectionIds },
      isActive: true,
    }).select('studentId').lean()
    const studentIds = enrollments.map(e => e.studentId)
    return { studentId: { $in: studentIds } }
  }

  return { studentId: new mongoose.Types.ObjectId() }
}

// ─── GET ALL ──────────────────────────────────────────────────────────────────

export const getAllActionPlans = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 10, teacherId, startDate, endDate } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const constraint = await buildStudentConstraint(req);
  const filter: any = { ...constraint };

  // teacherId filter: only admin/coordinator may filter by a specific teacher
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) {
    if (teacherId) {
      if (!mongoose.isValidObjectId(teacherId)) {
        sendResponse(res, 400, false, 'Invalid teacherId');
        return;
      }
      const userDoc = await UserAccount.findById(teacherId);
      if (!userDoc || !['admin', 'teacher'].includes(userDoc.role)) {
        sendResponse(res, 400, false, 'Invalid teacherId: User does not exist or lacks required role');
        return;
      }
      filter.teacherId = teacherId;
    }
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

// ─── GET BY STUDENT ───────────────────────────────────────────────────────────

export const getActionPlansByStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { page = 1, limit = 10, startDate, endDate } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }

  try {
    // Access check
    const user = req.user!
    if (user.role === 'parent') {
      await assertParentOwnsStudent(user.id, studentId)
    } else if (user.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, studentId)
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
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error fetching action plans`, null, error);
  }
};

// ─── GET BY TEACHER ───────────────────────────────────────────────────────────

export const getActionPlansByTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const { teacherId } = req.params;
  const { page = 1, limit = 10, studentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId');
    return;
  }

  // Teachers may only query their own plans
  const user = req.user!
  if (user.role === 'teacher' && teacherId !== user.id.toString()) {
    sendResponse(res, 403, false, 'Forbidden: You can only view your own action plans');
    return;
  }

  const userDoc = await UserAccount.findById(teacherId);
  if (!userDoc || !['admin', 'teacher'].includes(userDoc.role)) {
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

// ─── GET BY ID ────────────────────────────────────────────────────────────────

export const getActionPlanById = async (req: AuthRequest, res: Response): Promise<void> => {
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

    const user = req.user!
    const studentId = (plan.studentId as any)?._id || plan.studentId
    if (user.role === 'parent') {
      await assertParentOwnsStudent(user.id, studentId)
    } else if (user.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, studentId)
    }

    sendResponse(res, 200, true, 'Action plan fetched successfully', plan);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error fetching action plan`, null, error);
  }
};

// ─── CREATE ───────────────────────────────────────────────────────────────────

export const createActionPlan = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId, issue, goal, actionSteps, startDate, endDate } = req.body;

  // teacherId always from the logged-in user (admin/coordinator may pass override)
  const effectiveTeacherId = resolveTeacherId(req);

  // Validate required fields
  if (!studentId || !issue || !goal || !actionSteps || !Array.isArray(actionSteps) || actionSteps.length === 0 || !startDate || !endDate) {
    sendResponse(res, 400, false, 'Missing required fields: studentId, issue, goal, actionSteps (non-empty array), startDate, or endDate');
    return;
  }

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
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

  if (!actionSteps.every((item: any) =>
    item &&
    typeof item.step === 'string' &&
    item.step.trim().length >= 5 &&
    item.step.trim().length <= 500 &&
    (item.completed === undefined || typeof item.completed === 'boolean') &&
    (item.responsibleParty === undefined || VALID_RESPONSIBLE_PARTIES.includes(item.responsibleParty))
  )) {
    sendResponse(res, 400, false, 'Invalid actionSteps: Each must have step (5–500 chars), optional completed (boolean), and optional responsibleParty ("teacher", "parent", or "either")');
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
    // Access guard: homeroom teacher only
    const user = req.user!
    if (user.role === 'teacher') {
      await assertTeacherCanWriteStudent(effectiveTeacherId, studentId)
    }

    // Validate references
    const student = await Student.findById(studentId);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found');
      return;
    }
    const userDoc = await UserAccount.findById(effectiveTeacherId);
    if (!userDoc || !['admin', 'teacher'].includes(userDoc.role)) {
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
      teacherId: effectiveTeacherId,
      issue: issue.trim(),
      goal: goal.trim(),
      actionSteps: actionSteps.map((item: any) => ({
        step: item.step.trim(),
        completed: item.completed ?? false,
        responsibleParty: item.responsibleParty ?? 'teacher'
      })),
      startDate: start,
      endDate: end
    });

    const populated = await ActionPlan.findById(actionPlan._id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean({ virtuals: true });
    sendResponse(res, 201, true, 'Action plan created successfully', populated);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error creating action plan`, null, error);
  }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────

export const updateActionPlan = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { studentId, issue, goal, actionSteps, startDate, endDate } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid action plan ID');
    return;
  }
  if (!studentId && !issue && !goal && !actionSteps && !startDate && !endDate) {
    sendResponse(res, 400, false, 'At least one field required for update');
    return;
  }

  try {
    const actionPlan = await ActionPlan.findById(id);
    if (!actionPlan) {
      sendResponse(res, 404, false, 'ActionPlan not found');
      return;
    }

    // Access guard: homeroom teacher only; subject teachers cannot update action plans
    const user = req.user!
    if (user.role === 'teacher') {
      await assertTeacherCanWriteStudent(user.id, actionPlan.studentId.toString())
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
    if (issue && (typeof issue !== 'string' || issue.trim().length < 5 || issue.trim().length > 500)) {
      sendResponse(res, 400, false, 'Invalid issue: Must be 5–500 characters');
      return;
    }
    if (goal && (typeof goal !== 'string' || goal.trim().length < 5 || goal.trim().length > 500)) {
      sendResponse(res, 400, false, 'Invalid goal: Must be 5–500 characters');
      return;
    }

    if (actionSteps) {
      if (!Array.isArray(actionSteps) || actionSteps.length === 0) {
        sendResponse(res, 400, false, 'actionSteps must be a non-empty array');
        return;
      }
      if (!actionSteps.every((item: any) =>
        item &&
        typeof item.step === 'string' &&
        item.step.trim().length >= 5 &&
        item.step.trim().length <= 500 &&
        (item.completed === undefined || typeof item.completed === 'boolean') &&
        (item.responsibleParty === undefined || VALID_RESPONSIBLE_PARTIES.includes(item.responsibleParty))
      )) {
        sendResponse(res, 400, false, 'Invalid actionSteps: Each must have step (5–500 chars), optional completed (boolean), and optional responsibleParty ("teacher", "parent", or "either")');
        return;
      }
    }

    // Date validation
    let finalStartDate = actionPlan.startDate;
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
      finalStartDate = start;
    }

    let finalEndDate = actionPlan.endDate;
    if (endDate) {
      const end = new Date(endDate);
      if (isNaN(end.getTime())) {
        sendResponse(res, 400, false, 'Invalid endDate');
        return;
      }
      const maxEndDate = new Date(finalStartDate);
      maxEndDate.setMonth(maxEndDate.getMonth() + 6);
      if (end > maxEndDate) {
        sendResponse(res, 400, false, 'endDate must be within 6 months of startDate');
        return;
      }
      if (end < finalStartDate) {
        sendResponse(res, 400, false, 'endDate must be on or after startDate');
        return;
      }
      finalEndDate = end;
    }

    // Check duplicate issue if changing student or issue
    if ((studentId && studentId.toString() !== actionPlan.studentId.toString()) ||
        (issue && issue.trim() !== actionPlan.issue)) {
      const existingPlan = await ActionPlan.findOne({
        studentId: studentId || actionPlan.studentId,
        issue: issue ? issue.trim() : actionPlan.issue
      });
      if (existingPlan && existingPlan._id.toString() !== id) {
        sendResponse(res, 400, false, 'An action plan for this student and issue already exists');
        return;
      }
    }

    // Apply updates (teacherId is never updated via body — only admin/coordinator can have entered on behalf)
    if (studentId) actionPlan.studentId = studentId;
    if (issue) actionPlan.issue = issue.trim();
    if (goal) actionPlan.goal = goal.trim();
    if (actionSteps) {
      actionPlan.actionSteps = actionSteps.map((item: any) => ({
        step: item.step.trim(),
        completed: item.completed ?? false,
        responsibleParty: item.responsibleParty ?? 'teacher'
      }));
    }
    if (startDate) actionPlan.startDate = finalStartDate;
    if (endDate) actionPlan.endDate = finalEndDate;

    await actionPlan.save();

    const updated = await ActionPlan.findById(id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean({ virtuals: true });

    sendResponse(res, 200, true, 'Action plan updated successfully', updated);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error updating action plan`, null, error);
  }
};

// ─── UPDATE STEP ──────────────────────────────────────────────────────────────

export const updateActionPlanStep = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, stepIndex } = req.params;
  const { step, completed, responsibleParty } = req.body;

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
  if (responsibleParty !== undefined && !VALID_RESPONSIBLE_PARTIES.includes(responsibleParty)) {
    sendResponse(res, 400, false, 'Invalid responsibleParty: Must be "teacher", "parent", or "either"');
    return;
  }
  if (step === undefined && completed === undefined && responsibleParty === undefined) {
    sendResponse(res, 400, false, 'At least one field (step, completed, responsibleParty) required for update');
    return;
  }

  try {
    const actionPlan = await ActionPlan.findById(id);
    if (!actionPlan) {
      sendResponse(res, 404, false, 'ActionPlan not found');
      return;
    }

    // Access guard: homeroom teacher only
    const user = req.user!
    if (user.role === 'teacher') {
      await assertTeacherCanWriteStudent(user.id, actionPlan.studentId.toString())
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
    if (responsibleParty !== undefined) {
      actionPlan.actionSteps[index].responsibleParty = responsibleParty;
    }

    await actionPlan.save();

    const updated = await ActionPlan.findById(id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean({ virtuals: true });
    sendResponse(res, 200, true, 'Action plan step updated successfully', updated);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error updating action plan step`, null, error);
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const deleteActionPlan = async (req: AuthRequest, res: Response): Promise<void> => {
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

    await ActionPlan.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Action plan deleted successfully');
  } catch (error) {
    sendResponse(res, 500, false, `Server error deleting action plan: ${(error as Error).message}`, null, error);
  }
};