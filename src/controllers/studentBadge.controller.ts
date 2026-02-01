import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { StudentBadge } from '../models/studentBadge.model.js';
import { BadgeDefinition } from '../models/badgeDefinition.model.js';
import { Student } from '../models/student.model.js';
import UserAccount  from '../models/userAccount.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';

export const getAllStudentBadges = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, studentId, badgeId, teacherId, criteriaMet } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
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
  if (badgeId) {
    if (!mongoose.isValidObjectId(badgeId)) {
      sendResponse(res, 400, false, 'Invalid badgeId');
      return;
    }
    const badgeDefinition = await BadgeDefinition.findById(badgeId);
    if (!badgeDefinition) {
      sendResponse(res, 404, false, 'BadgeDefinition not found');
      return;
    }
    filter.badgeId = badgeId;
  }
  if (teacherId) {
    if (!mongoose.isValidObjectId(teacherId)) {
      sendResponse(res, 400, false, 'Invalid teacherId');
      return;
    }
    const user = await UserAccount.findById(teacherId);
    if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
      sendResponse(res, 400, false, 'Invalid teacherId: User does not exist or lacks required role (admin, coordinator, teacher)');
      return;
    }
    filter.teacherId = teacherId;
  }
  if (criteriaMet !== undefined) {
    if (criteriaMet !== 'true' && criteriaMet !== 'false') {
      sendResponse(res, 400, false, 'Invalid criteriaMet: must be true or false');
      return;
    }
    filter.criteriaMet = criteriaMet === 'true';
  }

  try {
    const badges = await StudentBadge.find(filter)
      .populate('badgeId', 'name description icon level')
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await StudentBadge.countDocuments(filter);

    sendResponse(res, 200, true, 'Student badges fetched successfully', badges, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching student badges: ${(error as Error).message}`, null, error);
  }
};

export const getStudentBadgeById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid student badge ID');
    return;
  }

  try {
    const badge = await StudentBadge.findById(id)
      .populate('badgeId', 'name description icon level')
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean();
    if (!badge) {
      sendResponse(res, 404, false, 'StudentBadge not found');
      return;
    }
    sendResponse(res, 200, true, 'Student badge fetched successfully', badge);
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching student badge: ${(error as Error).message}`, null, error);
  }
};

export const createStudentBadge = async (req: Request, res: Response): Promise<void> => {
  const { badgeId, studentId, teacherId, criteriaMet } = req.body;

  // Validate required fields
  if (!badgeId || !studentId || !teacherId) {
    sendResponse(res, 400, false, 'Missing required fields: badgeId, studentId, or teacherId');
    return;
  }
  if (!mongoose.isValidObjectId(badgeId)) {
    sendResponse(res, 400, false, 'Invalid badgeId');
    return;
  }
  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }
  if (!mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId');
    return;
  }
  if (criteriaMet !== undefined && typeof criteriaMet !== 'boolean') {
    sendResponse(res, 400, false, 'criteriaMet must be a boolean');
    return;
  }

  try {
    // Validate referenced documents
    const badgeDefinition = await BadgeDefinition.findById(badgeId);
    if (!badgeDefinition) {
      sendResponse(res, 404, false, 'BadgeDefinition not found');
      return;
    }
    const student = await Student.findById(studentId);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found');
      return;
    }
    const user = await UserAccount.findById(teacherId);
    if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
      sendResponse(res, 400, false, 'Invalid teacherId: User does not exist or lacks required role (admin, coordinator, teacher)');
      return;
    }

    // Check for duplicate
    const existingBadge = await StudentBadge.findOne({ badgeId, studentId });
    if (existingBadge) {
      sendResponse(res, 400, false, 'Student already awarded this badge');
      return;
    }

    const studentBadge = await StudentBadge.create({
      badgeId,
      studentId,
      teacherId,
      criteriaMet: criteriaMet !== undefined ? criteriaMet : false
    });

    sendResponse(res, 201, true, 'Student badge created successfully', studentBadge);
  } catch (error) {
    sendResponse(res, 500, false, `Server error creating student badge: ${(error as Error).message}`, null, error);
  }
};

export const updateStudentBadge = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { badgeId, studentId, teacherId, criteriaMet } = req.body;

  // Validate inputs
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid student badge ID');
    return;
  }
  if (!badgeId && !studentId && !teacherId && criteriaMet === undefined) {
    sendResponse(res, 400, false, 'At least one field (badgeId, studentId, teacherId, criteriaMet) required');
    return;
  }
  if (badgeId && !mongoose.isValidObjectId(badgeId)) {
    sendResponse(res, 400, false, 'Invalid badgeId');
    return;
  }
  if (studentId && !mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }
  if (teacherId && !mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId');
    return;
  }
  if (criteriaMet !== undefined && typeof criteriaMet !== 'boolean') {
    sendResponse(res, 400, false, 'criteriaMet must be a boolean');
    return;
  }

  try {
    const studentBadge = await StudentBadge.findById(id);
    if (!studentBadge) {
      sendResponse(res, 404, false, 'StudentBadge not found');
      return;
    }

    // Validate referenced documents
    if (badgeId) {
      const badgeDefinition = await BadgeDefinition.findById(badgeId);
      if (!badgeDefinition) {
        sendResponse(res, 404, false, 'BadgeDefinition not found');
        return;
      }
    }
    if (studentId) {
      const student = await Student.findById(studentId);
      if (!student) {
        sendResponse(res, 404, false, 'Student not found');
        return;
      }
    }
    if (teacherId) {
      const user = await UserAccount.findById(teacherId);
      if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
        sendResponse(res, 400, false, 'Invalid teacherId: User does not exist or lacks required role (admin, coordinator, teacher)');
        return;
      }
    }

    // Check for duplicate
    if ((badgeId && badgeId !== studentBadge.badgeId.toString()) || (studentId && studentId !== studentBadge.studentId.toString())) {
      const existingBadge = await StudentBadge.findOne({
        badgeId: badgeId || studentBadge.badgeId,
        studentId: studentId || studentBadge.studentId
      });
      if (existingBadge && existingBadge._id.toString() !== id) {
        sendResponse(res, 400, false, 'Student already awarded this badge');
        return;
      }
    }

    const updateData: any = {};
    if (badgeId) updateData.badgeId = badgeId;
    if (studentId) updateData.studentId = studentId;
    if (teacherId) updateData.teacherId = teacherId;
    if (criteriaMet !== undefined) updateData.criteriaMet = criteriaMet;

    const updated = await StudentBadge.findByIdAndUpdate(id, updateData, { new: true })
      .populate('badgeId', 'name description icon level')
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .lean();
    sendResponse(res, 200, true, 'Student badge updated successfully', updated);
  } catch (error) {
    sendResponse(res, 500, false, `Server error updating student badge: ${(error as Error).message}`, null, error);
  }
};

export const deleteStudentBadge = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid student badge ID');
    return;
  }

  try {
    const studentBadge = await StudentBadge.findById(id);
    if (!studentBadge) {
      sendResponse(res, 404, false, 'StudentBadge not found');
      return;
    }

    await StudentBadge.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Student badge deleted successfully');
  } catch (error) {
    sendResponse(res, 500, false, `Server error deleting student badge: ${(error as Error).message}`, null, error);
  }
};