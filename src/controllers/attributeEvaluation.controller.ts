import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AttributeEvaluation } from '../models/attributeEvaluation.model';
import { Student } from '../models/student.model';
import  UserAccount from '../models/userAccount.model';
import { StudentEnrollment } from '../models/studentEnrollment.model';
import { BadgeCriteria } from '../models/badgeCriteria.model';
import { AttributeCategory } from '../models/attributeCategory.model';

export const getAllAttributeEvaluations = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, teacherId, studentId, enrollmentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (teacherId) {
    if (!mongoose.isValidObjectId(teacherId)) {
      res.status(400).json({ message: 'Invalid teacherId' });
      return;
    }
    const user = await UserAccount.findById(teacherId);
    if (!user || !['admin', 'teacher'].includes(user.role)) {
      res.status(400).json({ message: 'Invalid teacherId: User does not exist or lacks required role' });
      return;
    }
    filter.teacherId = teacherId;
  }
  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      res.status(400).json({ message: 'Invalid studentId' });
      return;
    }
    filter.studentId = studentId;
  }
  if (enrollmentId) {
    if (!mongoose.isValidObjectId(enrollmentId)) {
      res.status(400).json({ message: 'Invalid enrollmentId' });
      return;
    }
    filter.studentEnrollmentId = enrollmentId;
  }

  try {
    const evaluations = await AttributeEvaluation.find(filter)
      .populate('studentId teacherId studentEnrollmentId attributes.attributeId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await AttributeEvaluation.countDocuments(filter);

    res.status(200).json({
      data: evaluations,
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching evaluations: ${(error as Error).message}` });
  }
};

export const getAttributeEvaluationsByStudent = async (req: Request, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { page = 1, limit = 10, enrollmentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(studentId)) {
    res.status(400).json({ message: 'Invalid studentId' });
    return;
  }
  const student = await Student.findById(studentId);
  if (!student) {
    res.status(404).json({ message: 'Student not found' });
    return;
  }

  const filter: any = { studentId };
  if (enrollmentId) {
    if (!mongoose.isValidObjectId(enrollmentId)) {
      res.status(400).json({ message: 'Invalid enrollmentId' });
      return;
    }
    filter.studentEnrollmentId = enrollmentId;
  }

  try {
    const evaluations = await AttributeEvaluation.find(filter)
      .populate('studentId teacherId studentEnrollmentId attributes.attributeId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await AttributeEvaluation.countDocuments(filter);

    res.status(200).json({
      data: evaluations,
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching evaluations: ${(error as Error).message}` });
  }
};

export const getAttributeEvaluationsByTeacher = async (req: Request, res: Response): Promise<void> => {
  const { teacherId } = req.params;
  const { page = 1, limit = 10, studentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId)) {
    res.status(400).json({ message: 'Invalid teacherId' });
    return;
  }
  const user = await UserAccount.findById(teacherId);
  if (!user || !['admin', 'teacher'].includes(user.role)) {
    res.status(400).json({ message: 'Invalid teacherId: User does not exist or lacks required role' });
    return;
  }

  const filter: any = { teacherId };
  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      res.status(400).json({ message: 'Invalid studentId' });
      return;
    }
    filter.studentId = studentId;
  }

  try {
    const evaluations = await AttributeEvaluation.find(filter)
      .populate('studentId teacherId studentEnrollmentId attributes.attributeId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await AttributeEvaluation.countDocuments(filter);

    res.status(200).json({
      data: evaluations,
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching evaluations: ${(error as Error).message}` });
  }
};

export const getAttributeEvaluationById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid evaluation ID' });
    return;
  }

  try {
    const evaluation = await AttributeEvaluation.findById(id)
      .populate('studentId teacherId studentEnrollmentId attributes.attributeId')
      .lean();
    if (!evaluation) {
      res.status(404).json({ message: 'AttributeEvaluation not found' });
      return;
    }
    res.status(200).json({ data: evaluation });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching evaluation: ${(error as Error).message}` });
  }
};

export const createAttributeEvaluation = async (req: Request, res: Response): Promise<void> => {
  const { studentId, teacherId, studentEnrollmentId, attributes, remark } = req.body;

  // Validate required fields
  if (!studentId || !teacherId || !studentEnrollmentId || !attributes || !Array.isArray(attributes) || attributes.length === 0) {
    res.status(400).json({ message: 'Missing required fields: studentId, teacherId, studentEnrollmentId, attributes (non-empty array)' });
    return;
  }

  // Validate IDs
  if (!mongoose.isValidObjectId(studentId)) {
    res.status(400).json({ message: 'Invalid studentId' });
    return;
  }
  if (!mongoose.isValidObjectId(teacherId)) {
    res.status(400).json({ message: 'Invalid teacherId' });
    return;
  }
  if (!mongoose.isValidObjectId(studentEnrollmentId)) {
    res.status(400).json({ message: 'Invalid studentEnrollmentId' });
    return;
  }

  // Validate attributes
  if (!attributes.every((item: any) => 
    item && 
    mongoose.isValidObjectId(item.attributeId) && 
    typeof item.score === 'number' && item.score >= 1 && item.score <= 5 &&
    (item.comment === undefined || (typeof item.comment === 'string' && item.comment.length <= 200))
  )) {
    res.status(400).json({ message: 'Invalid attributes: Each must have valid attributeId, score (1-5), optional comment (≤200 chars)' });
    return;
  }

  // Validate remark
  if (remark !== undefined && (typeof remark !== 'string' || remark.length > 500)) {
    res.status(400).json({ message: 'Invalid remark: Must be ≤500 characters if provided' });
    return;
  }

  try {
    // Validate references
    const student = await Student.findById(studentId);
    if (!student) {
      res.status(404).json({ message: 'Student not found' });
      return;
    }
    const user = await UserAccount.findById(teacherId);
    if (!user || !['admin', 'teacher'].includes(user.role)) {
      res.status(400).json({ message: 'Invalid teacherId: User does not exist or lacks required role (admin, teacher)' });
      return;
    }
    const enrollment = await StudentEnrollment.findById(studentEnrollmentId);
    if (!enrollment || enrollment.studentId.toString() !== studentId) {
      res.status(400).json({ message: 'Invalid studentEnrollmentId: Enrollment not found or does not match student' });
      return;
    }
    for (const attr of attributes) {
      const category = await AttributeCategory.findById(attr.attributeId);
      if (!category) {
        res.status(400).json({ message: `Invalid attributeId: ${attr.attributeId} not found` });
        return;
      }
    }

    // Calculate totalScore explicitly
    const totalScore = attributes.reduce((acc: number, item: any) => acc + item.score, 0);

    const evaluation = new AttributeEvaluation({
      studentId,
      teacherId,
      studentEnrollmentId,
      attributes: attributes.map((item: any) => ({
        attributeId: item.attributeId,
        score: item.score,
        comment: item.comment || ''
      })),
      totalScore, // Explicitly set
      remark: remark || ''
    });

    await evaluation.save();

    const populated = await AttributeEvaluation.findById(evaluation._id)
      .populate('studentId teacherId studentEnrollmentId attributes.attributeId')
      .lean();
    res.status(201).json({ message: 'Attribute evaluation created successfully', data: populated });
  } catch (error) {
    res.status(500).json({ message: `Server error creating evaluation: ${(error as Error).message}` });
  }
};


export const updateAttributeEvaluation = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { studentId, teacherId, studentEnrollmentId, attributes, remark } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid evaluation ID' });
    return;
  }
  if (!studentId && !teacherId && !studentEnrollmentId && !attributes && !remark) {
    res.status(400).json({ message: 'At least one field required for update' });
    return;
  }

  try {
    const evaluation = await AttributeEvaluation.findById(id);
    if (!evaluation) {
      res.status(404).json({ message: 'AttributeEvaluation not found' });
      return;
    }

    // Validate inputs if provided
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
    }
    if (teacherId) {
      if (!mongoose.isValidObjectId(teacherId)) {
        res.status(400).json({ message: 'Invalid teacherId' });
        return;
      }
      const user = await UserAccount.findById(teacherId);
      if (!user || !['admin', 'teacher'].includes(user.role)) {
        res.status(400).json({ message: 'Invalid teacherId: User does not exist or lacks required role' });
        return;
      }
    }
    if (studentEnrollmentId) {
      if (!mongoose.isValidObjectId(studentEnrollmentId)) {
        res.status(400).json({ message: 'Invalid studentEnrollmentId' });
        return;
      }
      const enrollment = await StudentEnrollment.findById(studentEnrollmentId);
      if (!enrollment || (studentId && enrollment.studentId.toString() !== studentId)) {
        res.status(400).json({ message: 'Invalid studentEnrollmentId: Enrollment not found or does not match student' });
        return;
      }
    }
    if (attributes) {
      if (!Array.isArray(attributes) || attributes.length === 0 || !attributes.every((item: any) => 
        item && 
        mongoose.isValidObjectId(item.attributeId) && 
        typeof item.score === 'number' && item.score >= 1 && item.score <= 5 &&
        (item.comment === undefined || (typeof item.comment === 'string' && item.comment.length <= 200))
      )) {
        res.status(400).json({ message: 'Invalid attributes: Each must have valid attributeId, score (1-5), optional comment (≤200 chars)' });
        return;
      }
      for (const attr of attributes) {
        const category = await AttributeCategory.findById(attr.attributeId);
        if (!category) {
          res.status(400).json({ message: `Invalid attributeId: ${attr.attributeId} not found` });
          return;
        }
      }
    }
    if (remark !== undefined && (typeof remark !== 'string' || remark.length > 500)) {
      res.status(400).json({ message: 'Invalid remark: Must be ≤500 characters if provided' });
      return;
    }

    // Check for duplicates if changing student or enrollment
    if ((studentId && studentId !== evaluation.studentId.toString()) || 
        (studentEnrollmentId && studentEnrollmentId !== evaluation.studentEnrollmentId.toString())) {
      const existing = await AttributeEvaluation.findOne({
        studentId: studentId || evaluation.studentId,
        studentEnrollmentId: studentEnrollmentId || evaluation.studentEnrollmentId
      });
      if (existing && existing._id.toString() !== id) {
        res.status(400).json({ message: 'An evaluation for this student and enrollment already exists' });
        return;
      }
    }

    const updateData: any = {};
    if (studentId) updateData.studentId = studentId;
    if (teacherId) updateData.teacherId = teacherId;
    if (studentEnrollmentId) updateData.studentEnrollmentId = studentEnrollmentId;
    if (attributes) {
      updateData.attributes = attributes.map((item: any) => ({
        attributeId: item.attributeId,
        score: item.score,
        comment: item.comment || ''
      }));
      updateData.totalScore = attributes.reduce((acc: number, item: any) => acc + item.score, 0); // Explicitly set totalScore
    }
    if (remark !== undefined) updateData.remark = remark;

    const updated = await AttributeEvaluation.findByIdAndUpdate(id, updateData, { new: true })
      .populate('studentId teacherId studentEnrollmentId attributes.attributeId')
      .lean();
    res.status(200).json({ message: 'Attribute evaluation updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ message: `Server error updating evaluation: ${(error as Error).message}` });
  }
};


export const patchAttributeEvaluation = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { attributes, remark } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid evaluation ID' });
    return;
  }
  if (!attributes && !remark) {
    res.status(400).json({ message: 'At least one field (attributes, remark) required for update' });
    return;
  }
  if (attributes && (!Array.isArray(attributes) || attributes.length === 0 || !attributes.every((item: any) => 
    item && 
    mongoose.isValidObjectId(item.attributeId) && 
    (item.score === undefined || (typeof item.score === 'number' && item.score >= 1 && item.score <= 5)) &&
    (item.comment === undefined || (typeof item.comment === 'string' && item.comment.length <= 200))
  ))) {
    res.status(400).json({ message: 'Invalid attributes: Each must have valid attributeId, optional score (1-5), optional comment (≤200 chars)' });
    return;
  }
  if (remark !== undefined && (typeof remark !== 'string' || remark.length > 500)) {
    res.status(400).json({ message: 'Invalid remark: Must be ≤500 characters if provided' });
    return;
  }

  try {
    const evaluation = await AttributeEvaluation.findById(id);
    if (!evaluation) {
      res.status(404).json({ message: 'AttributeEvaluation not found' });
      return;
    }

    // Validate attributeIds
    if (attributes) {
      for (const attr of attributes) {
        const category = await AttributeCategory.findById(attr.attributeId);
        if (!category) {
          res.status(400).json({ message: `Invalid attributeId: ${attr.attributeId} not found` });
          return;
        }
        const existingAttr = evaluation.attributes.find(a => a.attributeId.toString() === attr.attributeId);
        if (!existingAttr) {
          res.status(400).json({ message: `Attribute ${attr.attributeId} not found in evaluation` });
          return;
        }
      }

      // Merge updates
      for (const attr of attributes) {
        const target = evaluation.attributes.find(a => a.attributeId.toString() === attr.attributeId);
        if (target) {
          if (attr.score !== undefined) target.score = attr.score;
          if (attr.comment !== undefined) target.comment = attr.comment;
        }
      }

      // Recalculate totalScore
      evaluation.totalScore = evaluation.attributes.reduce((acc, item) => acc + item.score, 0);
    }

    if (remark !== undefined) {
      evaluation.remark = remark;
    }

    await evaluation.save();

    const updated = await AttributeEvaluation.findById(id)
      .populate('studentId teacherId studentEnrollmentId attributes.attributeId')
      .lean();
    res.status(200).json({ message: 'Attribute evaluation patched successfully', data: updated });
  } catch (error) {
    res.status(500).json({ message: `Server error patching evaluation: ${(error as Error).message}` });
  }
};

export const deleteAttributeEvaluation = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid evaluation ID' });
    return;
  }

  try {
    const evaluation = await AttributeEvaluation.findById(id);
    if (!evaluation) {
      res.status(404).json({ message: 'AttributeEvaluation not found' });
      return;
    }

    // Check for badge criteria dependencies
    const dependentCriteria = await BadgeCriteria.findOne({ 
      $or: [
        { type: 'attributeScore', attributeCategoryId: { $in: evaluation.attributes.map(a => a.attributeId) } },
        { type: 'attributeEvaluationAverage', studentEnrollmentId: evaluation.studentEnrollmentId }
      ]
    });
    if (dependentCriteria) {
      res.status(400).json({ message: 'Cannot delete evaluation: Linked to badge criteria' });
      return;
    }

    await AttributeEvaluation.findByIdAndDelete(id);
    res.status(200).json({ message: 'Attribute evaluation deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: `Server error deleting evaluation: ${(error as Error).message}` });
  }
};