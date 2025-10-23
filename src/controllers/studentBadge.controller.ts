import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { StudentBadge } from '../models/studentBadge.model';
import { BadgeDefinition } from '../models/badgeDefinition.model';
import { Student } from '../models/student.model';
import UserAccount  from '../models/userAccount.model';

export const getAllStudentBadges = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, studentId, badgeId, teacherId, criteriaMet } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      res.status(400).json({ message: 'Invalid studentId' });
      return;
    }
    const student = await Student.findById(studentId);
    if (!student) {
      res.status(404).json({ message: 'Student not found' });
      return;
    }
    filter.studentId = studentId;
  }
  if (badgeId) {
    if (!mongoose.isValidObjectId(badgeId)) {
      res.status(400).json({ message: 'Invalid badgeId' });
      return;
    }
    const badgeDefinition = await BadgeDefinition.findById(badgeId);
    if (!badgeDefinition) {
      res.status(404).json({ message: 'BadgeDefinition not found' });
      return;
    }
    filter.badgeId = badgeId;
  }
  if (teacherId) {
    if (!mongoose.isValidObjectId(teacherId)) {
      res.status(400).json({ message: 'Invalid teacherId' });
      return;
    }
    const user = await UserAccount.findById(teacherId);
    if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
      res.status(400).json({ message: 'Invalid teacherId: User does not exist or lacks required role (admin, coordinator, teacher)' });
      return;
    }
    filter.teacherId = teacherId;
  }
  if (criteriaMet !== undefined) {
    if (criteriaMet !== 'true' && criteriaMet !== 'false') {
      res.status(400).json({ message: 'Invalid criteriaMet: must be true or false' });
      return;
    }
    filter.criteriaMet = criteriaMet === 'true';
  }

  try {
    const badges = await StudentBadge.find(filter)
      .populate('badgeId studentId teacherId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await StudentBadge.countDocuments(filter);

    res.status(200).json({
      data: badges,
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching student badges: ${(error as Error).message}` });
  }
};

export const getStudentBadgeById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid student badge ID' });
    return;
  }

  try {
    const badge = await StudentBadge.findById(id).populate('badgeId studentId teacherId').lean();
    if (!badge) {
      res.status(404).json({ message: 'StudentBadge not found' });
      return;
    }
    res.status(200).json({ data: badge });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching student badge: ${(error as Error).message}` });
  }
};

export const createStudentBadge = async (req: Request, res: Response): Promise<void> => {
  const { badgeId, studentId, teacherId, criteriaMet } = req.body;

  // Validate required fields
  if (!badgeId || !studentId || !teacherId) {
    res.status(400).json({ message: 'Missing required fields: badgeId, studentId, or teacherId' });
    return;
  }
  if (!mongoose.isValidObjectId(badgeId)) {
    res.status(400).json({ message: 'Invalid badgeId' });
    return;
  }
  if (!mongoose.isValidObjectId(studentId)) {
    res.status(400).json({ message: 'Invalid studentId' });
    return;
  }
  if (!mongoose.isValidObjectId(teacherId)) {
    res.status(400).json({ message: 'Invalid teacherId' });
    return;
  }
  if (criteriaMet !== undefined && typeof criteriaMet !== 'boolean') {
    res.status(400).json({ message: 'criteriaMet must be a boolean' });
    return;
  }

  try {
    // Validate referenced documents
    const badgeDefinition = await BadgeDefinition.findById(badgeId);
    if (!badgeDefinition) {
      res.status(404).json({ message: 'BadgeDefinition not found' });
      return;
    }
    const student = await Student.findById(studentId);
    if (!student) {
      res.status(404).json({ message: 'Student not found' });
      return;
    }
    const user = await UserAccount.findById(teacherId);
    if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
      res.status(400).json({ message: 'Invalid teacherId: User does not exist or lacks required role (admin, coordinator, teacher)' });
      return;
    }

    // Check for duplicate
    const existingBadge = await StudentBadge.findOne({ badgeId, studentId });
    if (existingBadge) {
      res.status(400).json({ message: 'Student already awarded this badge' });
      return;
    }

    const studentBadge = await StudentBadge.create({
      badgeId,
      studentId,
      teacherId,
      criteriaMet: criteriaMet !== undefined ? criteriaMet : false
    });

    res.status(201).json({ message: 'Student badge created successfully', data: studentBadge });
  } catch (error) {
    res.status(500).json({ message: `Server error creating student badge: ${(error as Error).message}` });
  }
};

export const updateStudentBadge = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { badgeId, studentId, teacherId, criteriaMet } = req.body;

  // Validate inputs
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid student badge ID' });
    return;
  }
  if (!badgeId && !studentId && !teacherId && criteriaMet === undefined) {
    res.status(400).json({ message: 'At least one field (badgeId, studentId, teacherId, criteriaMet) required' });
    return;
  }
  if (badgeId && !mongoose.isValidObjectId(badgeId)) {
    res.status(400).json({ message: 'Invalid badgeId' });
    return;
  }
  if (studentId && !mongoose.isValidObjectId(studentId)) {
    res.status(400).json({ message: 'Invalid studentId' });
    return;
  }
  if (teacherId && !mongoose.isValidObjectId(teacherId)) {
    res.status(400).json({ message: 'Invalid teacherId' });
    return;
  }
  if (criteriaMet !== undefined && typeof criteriaMet !== 'boolean') {
    res.status(400).json({ message: 'criteriaMet must be a boolean' });
    return;
  }

  try {
    const studentBadge = await StudentBadge.findById(id);
    if (!studentBadge) {
      res.status(404).json({ message: 'StudentBadge not found' });
      return;
    }

    // Validate referenced documents
    if (badgeId) {
      const badgeDefinition = await BadgeDefinition.findById(badgeId);
      if (!badgeDefinition) {
        res.status(404).json({ message: 'BadgeDefinition not found' });
        return;
      }
    }
    if (studentId) {
      const student = await Student.findById(studentId);
      if (!student) {
        res.status(404).json({ message: 'Student not found' });
        return;
      }
    }
    if (teacherId) {
      const user = await UserAccount.findById(teacherId);
      if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
        res.status(400).json({ message: 'Invalid teacherId: User does not exist or lacks required role (admin, coordinator, teacher)' });
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
        res.status(400).json({ message: 'Student already awarded this badge' });
        return;
      }
    }

    const updateData: any = {};
    if (badgeId) updateData.badgeId = badgeId;
    if (studentId) updateData.studentId = studentId;
    if (teacherId) updateData.teacherId = teacherId;
    if (criteriaMet !== undefined) updateData.criteriaMet = criteriaMet;

    const updated = await StudentBadge.findByIdAndUpdate(id, updateData, { new: true })
      .populate('badgeId studentId teacherId')
      .lean();
    res.status(200).json({ message: 'Student badge updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ message: `Server error updating student badge: ${(error as Error).message}` });
  }
};

export const deleteStudentBadge = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid student badge ID' });
    return;
  }

  try {
    const studentBadge = await StudentBadge.findById(id);
    if (!studentBadge) {
      res.status(404).json({ message: 'StudentBadge not found' });
      return;
    }

    await StudentBadge.findByIdAndDelete(id);
    res.status(200).json({ message: 'Student badge deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: `Server error deleting student badge: ${(error as Error).message}` });
  }
};