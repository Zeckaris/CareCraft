import { Response } from 'express';
import mongoose from 'mongoose';
import { AttributeEvaluation } from '../models/attributeEvaluation.model.js';
import { Student } from '../models/student.model.js';
import UserAccount from '../models/userAccount.model.js';
import { StudentEnrollment } from '../models/studentEnrollment.model.js';
import { BadgeCriteria } from '../models/badgeCriteria.model.js';
import { AttributeCategory } from '../models/attributeCategory.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import {
  resolveTeacherId,
  assertTeacherCanWriteStudent,
  assertTeacherCanReadStudent,
  assertParentOwnsStudent,
  getTeacherSectionIds,
} from '../middlewares/access.middleware.js';

// ─── helper ───────────────────────────────────────────────────────────────────

async function buildStudentConstraint(req: AuthRequest): Promise<any> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return {}

  if (user.role === 'parent') {
    const myStudent = await Student.findOne({ parentId: user.id }).select('_id').lean()
    if (!myStudent) return { studentId: new mongoose.Types.ObjectId() }
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

export const getAllAttributeEvaluations = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 10, teacherId, studentId, enrollmentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const constraint = await buildStudentConstraint(req);
  const filter: any = { ...constraint };

  const user = req.user!
  // teacherId filter: only admin/coordinator may filter by arbitrary teacher
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
  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      sendResponse(res, 400, false, 'Invalid studentId');
      return;
    }
    filter.studentId = studentId;
  }
  if (enrollmentId) {
    if (!mongoose.isValidObjectId(enrollmentId)) {
      sendResponse(res, 400, false, 'Invalid enrollmentId');
      return;
    }
    filter.studentEnrollmentId = enrollmentId;
  }

  try {
    const evaluations = await AttributeEvaluation.find(filter)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .populate('studentEnrollmentId', 'gradeId isActive')
      .populate('attributes.attributeId', 'name description minScore maxScore')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await AttributeEvaluation.countDocuments(filter);

    sendResponse(res, 200, true, 'Attribute evaluations fetched successfully', evaluations, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching evaluations: ${(error as Error).message}`, null, error);
  }
};

// ─── GET BY STUDENT ───────────────────────────────────────────────────────────

export const getAttributeEvaluationsByStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { page = 1, limit = 10, enrollmentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }

  try {
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
    if (enrollmentId) {
      if (!mongoose.isValidObjectId(enrollmentId)) {
        sendResponse(res, 400, false, 'Invalid enrollmentId');
        return;
      }
      filter.studentEnrollmentId = enrollmentId;
    }

    const evaluations = await AttributeEvaluation.find(filter)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .populate('studentEnrollmentId', 'gradeId isActive')
      .populate('attributes.attributeId', 'name description minScore maxScore')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await AttributeEvaluation.countDocuments(filter);

    sendResponse(res, 200, true, 'Student attribute evaluations fetched successfully', evaluations, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error fetching evaluations`, null, error);
  }
};

// ─── GET BY TEACHER ───────────────────────────────────────────────────────────

export const getAttributeEvaluationsByTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const { teacherId } = req.params;
  const { page = 1, limit = 10, studentId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId');
    return;
  }

  // Teachers may only query their own evaluations
  const user = req.user!
  if (user.role === 'teacher' && teacherId !== user.id.toString()) {
    sendResponse(res, 403, false, 'Forbidden: You can only view your own evaluations');
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
    filter.studentId = studentId;
  }

  try {
    const evaluations = await AttributeEvaluation.find(filter)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .populate('studentEnrollmentId', 'gradeId isActive')
      .populate('attributes.attributeId', 'name description minScore maxScore')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await AttributeEvaluation.countDocuments(filter);

    sendResponse(res, 200, true, 'Teacher attribute evaluations fetched successfully', evaluations, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching evaluations: ${(error as Error).message}`, null, error);
  }
};

// ─── GET BY ID ────────────────────────────────────────────────────────────────

export const getAttributeEvaluationById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid evaluation ID');
    return;
  }

  try {
    const evaluation = await AttributeEvaluation.findById(id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .populate('studentEnrollmentId', 'gradeId isActive')
      .populate('attributes.attributeId', 'name description minScore maxScore')
      .lean();
    if (!evaluation) {
      sendResponse(res, 404, false, 'AttributeEvaluation not found');
      return;
    }

    const user = req.user!
    const studentId = (evaluation.studentId as any)?._id || evaluation.studentId
    if (user.role === 'parent') {
      await assertParentOwnsStudent(user.id, studentId)
    } else if (user.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, studentId)
    }

    sendResponse(res, 200, true, 'Attribute evaluation fetched successfully', evaluation);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error fetching evaluation`, null, error);
  }
};

// ─── CREATE ───────────────────────────────────────────────────────────────────

export const createAttributeEvaluation = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId, studentEnrollmentId, attributes, remark } = req.body;

  // teacherId always from the logged-in user
  const effectiveTeacherId = resolveTeacherId(req);

  // Validate required fields
  if (!studentId || !studentEnrollmentId || !attributes || !Array.isArray(attributes) || attributes.length === 0) {
    sendResponse(res, 400, false, 'Missing required fields: studentId, studentEnrollmentId, attributes (non-empty array)');
    return;
  }

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }
  if (!mongoose.isValidObjectId(studentEnrollmentId)) {
    sendResponse(res, 400, false, 'Invalid studentEnrollmentId');
    return;
  }

  // Validate attributes
  if (!attributes.every((item: any) =>
    item &&
    mongoose.isValidObjectId(item.attributeId) &&
    typeof item.score === 'number' && item.score >= 1 && item.score <= 5 &&
    (item.comment === undefined || (typeof item.comment === 'string' && item.comment.length <= 200))
  )) {
    sendResponse(res, 400, false, 'Invalid attributes: Each must have valid attributeId, score (1-5), optional comment (≤200 chars)');
    return;
  }

  // Validate remark
  if (remark !== undefined && (typeof remark !== 'string' || remark.length > 500)) {
    sendResponse(res, 400, false, 'Invalid remark: Must be ≤500 characters if provided');
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
    const enrollment = await StudentEnrollment.findById(studentEnrollmentId);
    if (!enrollment || enrollment.studentId.toString() !== studentId) {
      sendResponse(res, 400, false, 'Invalid studentEnrollmentId: Enrollment not found or does not match student');
      return;
    }
    for (const attr of attributes) {
      const category = await AttributeCategory.findById(attr.attributeId);
      if (!category) {
        sendResponse(res, 400, false, `Invalid attributeId: ${attr.attributeId} not found`);
        return;
      }
    }

    // Calculate totalScore explicitly
    const totalScore = attributes.reduce((acc: number, item: any) => acc + item.score, 0);

    const evaluation = new AttributeEvaluation({
      studentId,
      teacherId: effectiveTeacherId,
      studentEnrollmentId,
      attributes: attributes.map((item: any) => ({
        attributeId: item.attributeId,
        score: item.score,
        comment: item.comment || ''
      })),
      totalScore,
      remark: remark || ''
    });

    await evaluation.save();

    const populated = await AttributeEvaluation.findById(evaluation._id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .populate('studentEnrollmentId', 'gradeId isActive')
      .populate('attributes.attributeId', 'name description minScore maxScore')
      .lean();
    sendResponse(res, 201, true, 'Attribute evaluation created successfully', populated);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error creating evaluation`, null, error);
  }
};

// ─── UPDATE (full replace) ────────────────────────────────────────────────────

export const updateAttributeEvaluation = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { studentId, studentEnrollmentId, attributes, remark } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid evaluation ID');
    return;
  }
  if (!studentId && !studentEnrollmentId && !attributes && !remark) {
    sendResponse(res, 400, false, 'At least one field required for update');
    return;
  }

  try {
    const evaluation = await AttributeEvaluation.findById(id);
    if (!evaluation) {
      sendResponse(res, 404, false, 'AttributeEvaluation not found');
      return;
    }

    // Access guard: homeroom teacher only
    const user = req.user!
    if (user.role === 'teacher') {
      await assertTeacherCanWriteStudent(user.id, evaluation.studentId.toString())
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
    if (studentEnrollmentId) {
      if (!mongoose.isValidObjectId(studentEnrollmentId)) {
        sendResponse(res, 400, false, 'Invalid studentEnrollmentId');
        return;
      }
      const enroll = await StudentEnrollment.findById(studentEnrollmentId);
      if (!enroll || (studentId && enroll.studentId.toString() !== studentId)) {
        sendResponse(res, 400, false, 'Invalid studentEnrollmentId: Enrollment not found or does not match student');
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
        sendResponse(res, 400, false, 'Invalid attributes: Each must have valid attributeId, score (1-5), optional comment (≤200 chars)');
        return;
      }
      for (const attr of attributes) {
        const category = await AttributeCategory.findById(attr.attributeId);
        if (!category) {
          sendResponse(res, 400, false, `Invalid attributeId: ${attr.attributeId} not found`);
          return;
        }
      }
    }
    if (remark !== undefined && (typeof remark !== 'string' || remark.length > 500)) {
      sendResponse(res, 400, false, 'Invalid remark: Must be ≤500 characters if provided');
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
        sendResponse(res, 400, false, 'An evaluation for this student and enrollment already exists');
        return;
      }
    }

    const updateData: any = {};
    if (studentId) updateData.studentId = studentId;
    // teacherId is never changed via update; it stays from when it was created
    if (studentEnrollmentId) updateData.studentEnrollmentId = studentEnrollmentId;
    if (attributes) {
      updateData.attributes = attributes.map((item: any) => ({
        attributeId: item.attributeId,
        score: item.score,
        comment: item.comment || ''
      }));
      updateData.totalScore = attributes.reduce((acc: number, item: any) => acc + item.score, 0);
    }
    if (remark !== undefined) updateData.remark = remark;

    const updated = await AttributeEvaluation.findByIdAndUpdate(id, updateData, { new: true })
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .populate('studentEnrollmentId', 'gradeId isActive')
      .populate('attributes.attributeId', 'name description minScore maxScore')
      .lean();
    sendResponse(res, 200, true, 'Attribute evaluation updated successfully', updated);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error updating evaluation`, null, error);
  }
};

// ─── PATCH (partial attribute update) ────────────────────────────────────────

export const patchAttributeEvaluation = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { attributes, remark } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid evaluation ID');
    return;
  }
  if (!attributes && !remark) {
    sendResponse(res, 400, false, 'At least one field (attributes, remark) required for update');
    return;
  }
  if (attributes && (!Array.isArray(attributes) || attributes.length === 0 || !attributes.every((item: any) =>
    item &&
    mongoose.isValidObjectId(item.attributeId) &&
    (item.score === undefined || (typeof item.score === 'number' && item.score >= 1 && item.score <= 5)) &&
    (item.comment === undefined || (typeof item.comment === 'string' && item.comment.length <= 200))
  ))) {
    sendResponse(res, 400, false, 'Invalid attributes: Each must have valid attributeId, optional score (1-5), optional comment (≤200 chars)');
    return;
  }
  if (remark !== undefined && (typeof remark !== 'string' || remark.length > 500)) {
    sendResponse(res, 400, false, 'Invalid remark: Must be ≤500 characters if provided');
    return;
  }

  try {
    const evaluation = await AttributeEvaluation.findById(id);
    if (!evaluation) {
      sendResponse(res, 404, false, 'AttributeEvaluation not found');
      return;
    }

    // Access guard: homeroom teacher only
    const user = req.user!
    if (user.role === 'teacher') {
      await assertTeacherCanWriteStudent(user.id, evaluation.studentId.toString())
    }

    // Validate attributeIds
    if (attributes) {
      for (const attr of attributes) {
        const category = await AttributeCategory.findById(attr.attributeId);
        if (!category) {
          sendResponse(res, 400, false, `Invalid attributeId: ${attr.attributeId} not found`);
          return;
        }
        const existingAttr = evaluation.attributes.find(a => a.attributeId.toString() === attr.attributeId);
        if (!existingAttr) {
          sendResponse(res, 400, false, `Attribute ${attr.attributeId} not found in evaluation`);
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
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email role')
      .populate('studentEnrollmentId', 'gradeId isActive')
      .populate('attributes.attributeId', 'name description minScore maxScore')
      .lean();
    sendResponse(res, 200, true, 'Attribute evaluation patched successfully', updated);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || `Server error patching evaluation`, null, error);
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const deleteAttributeEvaluation = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid evaluation ID');
    return;
  }

  try {
    const evaluation = await AttributeEvaluation.findById(id);
    if (!evaluation) {
      sendResponse(res, 404, false, 'AttributeEvaluation not found');
      return;
    }

    // Check for badge criteria dependencies
    const criteriaCount = await BadgeCriteria.countDocuments({
      $or: [
        { type: 'attributeScore', attributeCategoryId: { $in: evaluation.attributes.map(a => a.attributeId) } },
        { type: 'attributeEvaluationAverage', studentEnrollmentId: evaluation.studentEnrollmentId }
      ]
    });
    if (criteriaCount > 0) {
      sendResponse(
        res,
        400,
        false,
        `Cannot delete evaluation: still referenced by ${criteriaCount} badge criteria. Remove those first.`
      );
      return;
    }

    await AttributeEvaluation.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Attribute evaluation deleted successfully');
  } catch (error) {
    sendResponse(res, 500, false, `Server error deleting evaluation: ${(error as Error).message}`, null, error);
  }
};