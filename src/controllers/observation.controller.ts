import { Response } from 'express';
import { Observation } from '../models/observation.model.js';
import { Student } from '../models/student.model.js';
import UserAccount from '../models/userAccount.model.js';
import mongoose from 'mongoose';
import { StudentEnrollment } from '../models/studentEnrollment.model.js';
import { AttributeCategory } from '../models/attributeCategory.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import {
  resolveTeacherId,
  assertTeacherCanReadStudent,
  assertParentOwnsStudent,
  getTeacherSectionIds,
} from '../middlewares/access.middleware.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the studentId constraint for list queries based on the caller's role:
 *   - admin/coordinator: no constraint (returns null)
 *   - teacher: only students in sections they are assigned to
 *   - parent: only their own child
 * Returns null if there is no additional constraint.
 */
async function buildStudentConstraint(
  req: AuthRequest
): Promise<{ studentId?: any } | null> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return null

  if (user.role === 'parent') {
    const myStudent = await Student.findOne({ parentId: user.id }).select('_id').lean()
    if (!myStudent) return { studentId: null } // no student → return nothing
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

  return { studentId: null } // deny all
}

// ─── GET ALL ──────────────────────────────────────────────────────────────────

export const getAllObservations = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 10, studentId, teacherId, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  try {
    const filter: any = {};

    // Role-based scoping
    const constraint = await buildStudentConstraint(req);
    if (constraint) {
      if (constraint.studentId === null) {
        sendResponse(res, 403, false, 'No accessible students for your account');
        return;
      }
      // Merge constraint into filter
      if (studentId && mongoose.isValidObjectId(studentId)) {
        // Caller specified a studentId — verify it's within their allowed set
        const constraintStudentId = constraint.studentId;
        if (constraintStudentId.$in) {
          const allowed = constraintStudentId.$in.map((id: any) => id.toString());
          if (!allowed.includes(studentId as string)) {
            sendResponse(res, 403, false, 'Forbidden: Access denied for this student');
            return;
          }
          filter.studentId = studentId;
        } else {
          // Parent case: single student
          if (constraintStudentId.toString() !== studentId as string) {
            sendResponse(res, 403, false, 'Forbidden: Access denied for this student');
            return;
          }
          filter.studentId = studentId;
        }
      } else {
        Object.assign(filter, constraint);
      }
    } else {
      // admin/coordinator: apply optional filter
      if (studentId && mongoose.isValidObjectId(studentId)) filter.studentId = studentId;
    }

    // Optional teacherId filter
    if (teacherId && mongoose.isValidObjectId(teacherId)) {
      filter.teacherId = teacherId;
    }

    if (category) {
      if (!mongoose.isValidObjectId(category)) {
        sendResponse(res, 400, false, 'Invalid category ID');
        return;
      }
      filter.category = category;
    }

    const observations = await Observation.find(filter)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Observation.countDocuments(filter);

    sendResponse(res, 200, true, 'Observations fetched successfully', observations, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching observations.', null, error);
  }
};

// ─── GET BY ID ────────────────────────────────────────────────────────────────

export const getObservationById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid observation ID');
    return;
  }

  try {
    const observation = await Observation.findById(id)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore');

    if (!observation) {
      sendResponse(res, 404, false, 'Observation not found.');
      return;
    }

    const user = req.user!
    const studentId = (observation.studentId as any)?._id || observation.studentId

    if (user.role === 'parent') {
      await assertParentOwnsStudent(user.id, studentId)
    } else if (user.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, studentId)
    }

    sendResponse(res, 200, true, 'Observation fetched successfully', observation);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || 'Server error fetching observation.');
  }
};

// ─── CREATE ───────────────────────────────────────────────────────────────────

export const createObservation = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId, date, category, description, score } = req.body;

  if (!studentId) {
    sendResponse(res, 400, false, 'Missing required field: studentId');
    return;
  }
  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }
  if (!date || !category || !description || score === undefined) {
    sendResponse(res, 400, false, 'Missing required fields: date, category, description, or score');
    return;
  }
  if (!mongoose.isValidObjectId(category)) {
    sendResponse(res, 400, false, 'Invalid category ID');
    return;
  }

  // teacherId always comes from the logged-in user (unless admin/coordinator passes an override)
  const effectiveTeacherId = resolveTeacherId(req);

  try {
    // Access guard: teacher must be assigned to this student's section
    const user = req.user!
    if (user.role === 'teacher') {
      await assertTeacherCanReadStudent(effectiveTeacherId, studentId)
    }

    const attributeCategory = await AttributeCategory.findById(category);
    if (!attributeCategory) {
      sendResponse(res, 404, false, 'AttributeCategory not found');
      return;
    }
    if (score < attributeCategory.minScore || score > attributeCategory.maxScore) {
      sendResponse(res, 400, false, `Score must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}`);
      return;
    }
    const student = await Student.findById(studentId);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found.');
      return;
    }

    const observation = await Observation.create({
      studentId,
      teacherId: effectiveTeacherId,
      date: new Date(date),
      category,
      description,
      score
    });

    const populatedObservation = await Observation.findById(observation._id)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore');

    sendResponse(res, 201, true, 'Observation created successfully.', populatedObservation);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || 'Server error creating observation.');
  }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────

export const updateObservation = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { date, category, description, score } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid observation ID');
    return;
  }

  if (!date && !category && !description && score === undefined) {
    sendResponse(res, 400, false, 'At least one field (date, category, description, score) required.');
    return;
  }

  if (category && !mongoose.isValidObjectId(category)) {
    sendResponse(res, 400, false, 'Invalid category ID');
    return;
  }

  try {
    const observation = await Observation.findById(id);
    if (!observation) {
      sendResponse(res, 404, false, 'Observation not found.');
      return;
    }

    const user = req.user!
    // Subject teachers can only edit their own observations
    if (user.role === 'teacher') {
      if (observation.teacherId.toString() !== user.id.toString()) {
        sendResponse(res, 403, false, 'Forbidden: You can only edit your own observations');
        return;
      }
    }

    if (category) {
      const attributeCategory = await AttributeCategory.findById(category);
      if (!attributeCategory) {
        sendResponse(res, 404, false, 'AttributeCategory not found');
        return;
      }
    }

    // Validate score against current category if score is being updated
    if (score !== undefined) {
      const currentCategoryId = category || observation.category;
      const attributeCategory = await AttributeCategory.findById(currentCategoryId);
      if (attributeCategory && (score < attributeCategory.minScore || score > attributeCategory.maxScore)) {
        sendResponse(res, 400, false, `Score must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}`);
        return;
      }
    }

    const updateData: any = {};
    if (date) updateData.date = new Date(date);
    if (category) updateData.category = category;
    if (description) updateData.description = description;
    if (score !== undefined) updateData.score = score;

    const updated = await Observation.findByIdAndUpdate(id, updateData, { new: true })
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore');

    sendResponse(res, 200, true, 'Observation updated successfully.', updated);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || 'Server error updating observation.');
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const deleteObservation = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid observation ID');
    return;
  }

  try {
    const observation = await Observation.findById(id);
    if (!observation) {
      sendResponse(res, 404, false, 'Observation not found.');
      return;
    }

    const user = req.user!
    // Subject teachers can only delete their own observations
    if (user.role === 'teacher') {
      if (observation.teacherId.toString() !== user.id.toString()) {
        sendResponse(res, 403, false, 'Forbidden: You can only delete your own observations');
        return;
      }
    }

    await Observation.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Observation deleted successfully.');
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || 'Server error deleting observation.');
  }
};

// ─── GET BY STUDENT + DATE ────────────────────────────────────────────────────

export const getObservationsByStudentAndDate = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { startDate, endDate, category } = req.query;

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }
  if (!startDate || !endDate) {
    sendResponse(res, 400, false, 'Missing required fields: startDate or endDate');
    return;
  }

  try {
    const user = req.user!
    if (user.role === 'parent') {
      await assertParentOwnsStudent(user.id, studentId)
    } else if (user.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, studentId)
    }

    const filter: any = {
      studentId,
      date: {
        $gte: new Date(startDate as string),
        $lt: new Date(endDate as string)
      }
    };

    if (category) {
      if (!mongoose.isValidObjectId(category)) {
        sendResponse(res, 400, false, 'Invalid category ID');
        return;
      }
      filter.category = category;
    }

    const observations = await Observation.find(filter)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore')
      .sort({ date: -1 });

    sendResponse(res, 200, true, 'Observations fetched successfully', observations);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || 'Server error fetching observations');
  }
};

// ─── GET BY TEACHER ───────────────────────────────────────────────────────────

export const getObservationsByTeacher = async (req: AuthRequest, res: Response): Promise<void> => {
  const { teacherId } = req.params;
  const { page = 1, limit = 10, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId');
    return;
  }

  // Teachers may only query their own observations
  const user = req.user!
  if (user.role === 'teacher' && teacherId !== user.id.toString()) {
    sendResponse(res, 403, false, 'Forbidden: You can only view your own observations');
    return;
  }

  const filter: any = { teacherId };
  if (category) {
    if (!mongoose.isValidObjectId(category)) {
      sendResponse(res, 400, false, 'Invalid category ID');
      return;
    }
    filter.category = category;
  }

  try {
    const observations = await Observation.find(filter)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Observation.countDocuments(filter);

    sendResponse(res, 200, true, 'Teacher observations fetched successfully', observations, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching teacher observations.', null, error);
  }
};

// ─── BULK DELETE ──────────────────────────────────────────────────────────────

export const bulkDeleteObservationsByStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }

  try {
    const student = await Student.findById(studentId);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found.');
      return;
    }

    const result = await Observation.deleteMany({ studentId });
    sendResponse(res, 200, true, `Deleted ${result.deletedCount} observations successfully.`);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting observations.', null, error);
  }
};

// ─── GET BY TEACHER + GRADE ────────────────────────────────────────────────────

export const getObservationsByTeacherAndGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  const { teacherId, gradeId } = req.params;
  const { page = 1, limit = 10, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid teacherId or gradeId');
    return;
  }

  // Teachers may only query their own observations
  const user = req.user!
  if (user.role === 'teacher' && teacherId !== user.id.toString()) {
    sendResponse(res, 403, false, 'Forbidden: You can only view your own observations');
    return;
  }

  try {
    const teacher = await UserAccount.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      sendResponse(res, 404, false, 'Teacher not found or invalid role.');
      return;
    }

    // For teacher role: scope to their assigned sections only
    let enrollmentFilter: any = { gradeId, isActive: true };
    if (user.role === 'teacher') {
      const sectionIds = await getTeacherSectionIds(user.id);
      enrollmentFilter.sectionId = { $in: sectionIds };
    }

    const enrollments = await StudentEnrollment.find(enrollmentFilter).select('studentId');
    const studentIds = enrollments.map(enrollment => enrollment.studentId);

    if (!studentIds.length) {
      sendResponse(res, 200, true, 'No observations found', [], null, {
        total: 0,
        page: Number(page),
        limit: Number(limit)
      });
      return;
    }

    const filter: any = { teacherId, studentId: { $in: studentIds } };
    if (category) {
      if (!mongoose.isValidObjectId(category)) {
        sendResponse(res, 400, false, 'Invalid category ID');
        return;
      }
      filter.category = category;
    }

    const observations = await Observation.find(filter)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Observation.countDocuments(filter);

    sendResponse(res, 200, true, 'Observations fetched successfully', observations, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching observations by teacher and grade.', null, error);
  }
};

// ─── GET BY CATEGORY + GRADE ──────────────────────────────────────────────────

export const getObservationsByCategoryAndGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  const { gradeId } = req.params;
  const { category, page = 1, limit = 10 } = req.query;
  const user = req.user!
  const teacherId = user.id;

  if (!mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid gradeId');
    return;
  }
  if (!category) {
    sendResponse(res, 400, false, 'Category is required');
    return;
  }
  if (!mongoose.isValidObjectId(category)) {
    sendResponse(res, 400, false, 'Invalid category ID');
    return;
  }

  try {
    const attributeCategory = await AttributeCategory.findById(category);
    if (!attributeCategory) {
      sendResponse(res, 400, false, 'AttributeCategory not found');
      return;
    }

    // Scope enrollment query to teacher's assigned sections
    let enrollmentFilter: any = { gradeId, isActive: true };
    if (user.role === 'teacher') {
      const sectionIds = await getTeacherSectionIds(user.id);
      enrollmentFilter.sectionId = { $in: sectionIds };
    }

    const enrollments = await StudentEnrollment.find(enrollmentFilter).select('studentId');
    const studentIds = enrollments.map(enrollment => enrollment.studentId);

    if (!studentIds.length) {
      sendResponse(res, 200, true, 'No observations found', [], null, {
        total: 0,
        page: Number(page),
        limit: Number(limit)
      });
      return;
    }

    const filter: any = { teacherId, studentId: { $in: studentIds }, category };
    const skip = (Number(page) - 1) * Number(limit);

    const observations = await Observation.find(filter)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await Observation.countDocuments(filter);

    sendResponse(res, 200, true, 'Observations fetched successfully', observations, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching observations by category and grade.', null, error);
  }
};