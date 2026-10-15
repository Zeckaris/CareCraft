import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { StudentEnrollment } from '../models/studentEnrollment.model.js';
import { Student } from '../models/student.model.js';
import { AcademicCalendar } from '../models/academicCalendar.model.js';
import { Section } from '../models/section.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import {
  assertTeacherCanReadStudent,
  assertParentOwnsStudent,
  getTeacherSectionIds,
} from '../middlewares/access.middleware.js';

const getCurrentActiveCalendar = async () => {
  return await AcademicCalendar.findOne({ isCurrent: true });
};

const formatDate = (date: Date | string | undefined): string => {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

/**
 * Resolves sectionId for an enrollment:
 * - If explicit sectionId provided: validates that it exists, is active, and matches gradeId and schoolYear.
 * - If sectionId omitted:
 *   - Exactly 1 active section exists for (gradeId, schoolYear) -> auto-assigns it.
 *   - Several active sections exist -> returns error requiring sectionId.
 *   - No active sections exist -> returns error.
 */
export const resolveSectionForEnrollment = async (
  gradeId: any,
  schoolYear: string,
  explicitSectionId?: any
): Promise<{ sectionId?: Types.ObjectId; error?: string }> => {
  if (explicitSectionId) {
    if (!mongoose.isValidObjectId(explicitSectionId)) {
      return { error: 'Invalid sectionId' };
    }
    const section = await Section.findById(explicitSectionId);
    if (!section) {
      return { error: 'Section not found' };
    }
    if (section.gradeId.toString() !== gradeId.toString()) {
      return { error: 'Section does not belong to the selected grade' };
    }
    if (section.schoolYear !== schoolYear) {
      return { error: `Section belongs to school year ${section.schoolYear}, but enrollment is for ${schoolYear}` };
    }
    if (!section.isActive) {
      return { error: 'Cannot enroll in an inactive section' };
    }
    return { sectionId: section._id };
  }

  // Auto-assign logic when sectionId is omitted
  const activeSections = await Section.find({ gradeId, schoolYear, isActive: true });
  if (activeSections.length === 1) {
    return { sectionId: activeSections[0]._id };
  } else if (activeSections.length > 1) {
    const names = activeSections.map((s) => s.name).join(', ');
    return {
      error: `Multiple active sections exist for this grade and school year (${names}). Please specify a sectionId.`,
    };
  } else {
    return {
      error: 'No active section exists for this grade and school year. Please create a section first.',
    };
  }
};

export const getAllEnrollments = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 10, gradeId, schoolYear, isActive, search, sectionId, section } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (gradeId) filter.gradeId = gradeId;
  if (schoolYear) filter.schoolYear = schoolYear;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const targetSectionId = sectionId || section;
  if (targetSectionId) {
    if (!mongoose.isValidObjectId(targetSectionId)) {
      sendResponse(res, 400, false, 'Invalid sectionId');
      return;
    }
    filter.sectionId = targetSectionId;
  }

  const user = req.user;
  if (user?.role === 'parent') {
    const myStudent = await Student.findOne({ parentId: user.id }).select('_id').lean();
    if (!myStudent) {
      sendResponse(res, 200, true, 'Enrollments fetched successfully', [], null, {
        total: 0,
        page: Number(page),
        limit: Number(limit),
      });
      return;
    }
    filter.studentId = myStudent._id;
  } else if (user?.role === 'teacher') {
    const teacherSectionIds = await getTeacherSectionIds(user.id);
    if (teacherSectionIds.length === 0) {
      sendResponse(res, 200, true, 'Enrollments fetched successfully', [], null, {
        total: 0,
        page: Number(page),
        limit: Number(limit),
      });
      return;
    }
    if (targetSectionId) {
      if (!teacherSectionIds.some((sId) => sId.toString() === targetSectionId.toString())) {
        sendResponse(res, 403, false, 'Forbidden: You are not assigned to this section');
        return;
      }
      filter.sectionId = targetSectionId;
    } else {
      filter.sectionId = { $in: teacherSectionIds };
    }
  }

  try {
    let query = StudentEnrollment.find(filter)
      .populate('studentId', 'firstName middleName lastName profileImage')
      .populate('gradeId', 'level')
      .populate('sectionId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    if (search) {
      const students = await Student.find({
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { middleName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
        ],
      }).select('_id');

      const studentIds = students.map((s) => s._id);
      if (studentIds.length === 0) {
        sendResponse(res, 200, true, 'Enrollments fetched successfully', [], null, {
          total: 0,
          page: Number(page),
          limit: Number(limit),
        });
        return;
      }
      query = query.where('studentId').in(studentIds);
    }

    const enrollments = await query;
    const total = await StudentEnrollment.countDocuments(filter);

    sendResponse(res, 200, true, 'Enrollments fetched successfully', enrollments, null, {
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching enrollments.', null, error);
  }
};

export const getStudentEnrollments = async (req: AuthRequest, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { schoolYear, isActive, sectionId, section } = req.query;

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }

  const user = req.user;
  try {
    if (user?.role === 'parent') {
      await assertParentOwnsStudent(user.id, studentId);
    } else if (user?.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, studentId);
    }
  } catch (authErr: any) {
    sendResponse(res, authErr.statusCode || 403, false, authErr.message || 'Access denied');
    return;
  }

  const filter: any = { studentId };
  if (schoolYear) filter.schoolYear = schoolYear;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const targetSectionId = sectionId || section;
  if (targetSectionId) {
    if (!mongoose.isValidObjectId(targetSectionId)) {
      sendResponse(res, 400, false, 'Invalid sectionId');
      return;
    }
    filter.sectionId = targetSectionId;
  }

  try {
    const enrollments = await StudentEnrollment.find(filter)
      .populate('gradeId', 'level')
      .populate('sectionId', 'name')
      .sort({ schoolYear: -1 });

    sendResponse(res, 200, true, 'Student enrollments fetched successfully', {
      enrollments,
      count: enrollments.length,
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching student enrollments.', null, error);
  }
};

export const getEnrollmentById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid enrollment ID');
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id)
      .populate('studentId', 'firstName middleName lastName profileImage')
      .populate('gradeId', 'level')
      .populate('sectionId', 'name');

    if (!enrollment) {
      sendResponse(res, 404, false, 'Enrollment not found.');
      return;
    }

    const user = req.user;
    const studentId = (enrollment.studentId as any)?._id || enrollment.studentId;
    if (user?.role === 'parent') {
      await assertParentOwnsStudent(user.id, studentId);
    } else if (user?.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, studentId);
    }

    sendResponse(res, 200, true, 'Enrollment fetched successfully', enrollment);
  } catch (error: any) {
    sendResponse(res, error.statusCode || 500, false, error.message || 'Server error fetching enrollment.', null, error);
  }
};

export const createEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { studentId, gradeId, sectionId } = req.body;

  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid studentId or gradeId');
    return;
  }

  try {
    const currentCalendar = await getCurrentActiveCalendar();
    if (!currentCalendar) {
      sendResponse(res, 400, false, 'No active academic calendar found. Please set one first.');
      return;
    }

    const schoolYear = currentCalendar.academicYear;

    const today = new Date();
    const regStart = currentCalendar.registrationStartDate;
    const newRegEnd = currentCalendar.newStudentRegistrationEndDate;

    if (
      (regStart && today < new Date(regStart)) ||
      (newRegEnd && today > new Date(newRegEnd))
    ) {
      sendResponse(
        res,
        403,
        false,
        `Enrollment period is closed. Current window: ${
          regStart ? formatDate(regStart) : 'N/A'
        } to ${newRegEnd ? formatDate(newRegEnd) : 'N/A'}`
      );
      return;
    }

    const existing = await StudentEnrollment.findOne({ studentId, schoolYear, isActive: true });
    if (existing) {
      sendResponse(res, 400, false, `Student already has active enrollment for ${schoolYear}`);
      return;
    }

    const student = await Student.findById(studentId);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found.');
      return;
    }

    // Resolve section (explicit or automatic)
    const { sectionId: resolvedSectionId, error: sectionErr } = await resolveSectionForEnrollment(
      gradeId,
      schoolYear,
      sectionId
    );
    if (sectionErr) {
      sendResponse(res, 400, false, sectionErr);
      return;
    }

    const enrollment = await StudentEnrollment.create({
      studentId,
      gradeId,
      sectionId: resolvedSectionId,
      schoolYear,
      isActive: true,
    });
    await Student.findByIdAndUpdate(studentId, { enrollmentId: enrollment._id });

    const populated = await StudentEnrollment.findById(enrollment._id)
      .populate('studentId', 'firstName middleName lastName profileImage')
      .populate('gradeId', 'level')
      .populate('sectionId', 'name');

    sendResponse(res, 201, true, 'Enrollment created successfully.', populated);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error creating enrollment.', null, error);
  }
};

export const updateEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { gradeId, schoolYear: providedYear, isActive, sectionId } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid enrollment ID');
    return;
  }
  if (gradeId && !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid gradeId');
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      sendResponse(res, 404, false, 'Enrollment not found.');
      return;
    }

    if (isActive !== undefined && isActive !== enrollment.isActive && isActive) {
      await StudentEnrollment.updateMany(
        { studentId: enrollment.studentId, _id: { $ne: id }, isActive: true },
        { isActive: false }
      );
    }

    const targetGradeId = gradeId || enrollment.gradeId;
    const targetSchoolYear = providedYear || enrollment.schoolYear;

    const updateData: any = {};
    if (gradeId) updateData.gradeId = gradeId;
    if (providedYear) updateData.schoolYear = providedYear;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (sectionId !== undefined) {
      if (sectionId === null) {
        updateData.sectionId = null;
      } else {
        const { sectionId: resolvedSectionId, error: sectionErr } = await resolveSectionForEnrollment(
          targetGradeId,
          targetSchoolYear,
          sectionId
        );
        if (sectionErr) {
          sendResponse(res, 400, false, sectionErr);
          return;
        }
        updateData.sectionId = resolvedSectionId;
      }
    }

    const updated = await StudentEnrollment.findByIdAndUpdate(id, updateData, { new: true })
      .populate('studentId', 'firstName middleName lastName profileImage')
      .populate('gradeId', 'level')
      .populate('sectionId', 'name');

    sendResponse(res, 200, true, 'Enrollment updated successfully.', updated);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error updating enrollment.', null, error);
  }
};

export const toggleEnrollmentActive = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid enrollment ID');
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      sendResponse(res, 404, false, 'Enrollment not found.');
      return;
    }

    const newStatus = !enrollment.isActive;
    if (newStatus) {
      await StudentEnrollment.updateMany(
        { studentId: enrollment.studentId, _id: { $ne: id }, isActive: true },
        { isActive: false }
      );
    }

    const updated = await StudentEnrollment.findByIdAndUpdate(
      id,
      { isActive: newStatus },
      { new: true }
    )
      .populate('studentId', 'firstName middleName lastName profileImage')
      .populate('gradeId', 'level')
      .populate('sectionId', 'name');

    sendResponse(res, 200, true, `Enrollment ${newStatus ? 'activated' : 'deactivated'} successfully.`, updated);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error toggling enrollment.', null, error);
  }
};

export const deleteEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid enrollment ID');
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      sendResponse(res, 404, false, 'Enrollment not found.');
      return;
    }

    await Student.findByIdAndUpdate(enrollment.studentId, { enrollmentId: null });
    await StudentEnrollment.findByIdAndDelete(id);

    sendResponse(res, 200, true, 'Enrollment deleted successfully.');
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting enrollment.', null, error);
  }
};

export const getGradeEnrollments = async (req: AuthRequest, res: Response): Promise<void> => {
  const { gradeId } = req.params;
  const { schoolYear, isActive = 'true', sectionId, section } = req.query;

  if (!mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid gradeId');
    return;
  }

  const user = req.user;
  if (user?.role === 'parent') {
    sendResponse(res, 403, false, 'Forbidden: Parents cannot access grade enrollments');
    return;
  }

  const filter: any = { gradeId, isActive: isActive === 'true' };
  if (schoolYear) filter.schoolYear = schoolYear;

  const targetSectionId = sectionId || section;
  if (user?.role === 'teacher') {
    const teacherSectionIds = await getTeacherSectionIds(user.id);
    if (teacherSectionIds.length === 0) {
      sendResponse(res, 200, true, 'Grade enrollments fetched successfully', {
        enrollments: [],
        count: 0,
      });
      return;
    }
    if (targetSectionId) {
      if (!teacherSectionIds.some((sId) => sId.toString() === targetSectionId.toString())) {
        sendResponse(res, 403, false, 'Forbidden: You are not assigned to this section');
        return;
      }
      filter.sectionId = targetSectionId;
    } else {
      filter.sectionId = { $in: teacherSectionIds };
    }
  } else if (targetSectionId) {
    if (!mongoose.isValidObjectId(targetSectionId)) {
      sendResponse(res, 400, false, 'Invalid sectionId');
      return;
    }
    filter.sectionId = targetSectionId;
  }

  try {
    const enrollments = await StudentEnrollment.find(filter)
      .populate('studentId', 'firstName middleName lastName profileImage')
      .populate('gradeId', 'level')
      .populate('sectionId', 'name')
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, 'Grade enrollments fetched successfully', {
      enrollments,
      count: enrollments.length,
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching grade enrollments.', null, error);
  }
};

export const bulkCreateEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { studentIds, gradeId, sectionId } = req.body;

  if (!Array.isArray(studentIds) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid studentIds array or gradeId');
    return;
  }

  try {
    const currentCalendar = await getCurrentActiveCalendar();
    if (!currentCalendar) {
      sendResponse(res, 400, false, 'No active academic calendar found. Please set one first.');
      return;
    }

    const schoolYear = currentCalendar.academicYear;

    const today = new Date();
    const regStart = currentCalendar.registrationStartDate;
    const newRegEnd = currentCalendar.newStudentRegistrationEndDate;

    if (
      (regStart && today < new Date(regStart)) ||
      (newRegEnd && today > new Date(newRegEnd))
    ) {
      sendResponse(
        res,
        403,
        false,
        `Enrollment period is closed. Current window: ${
          regStart ? formatDate(regStart) : 'N/A'
        } to ${newRegEnd ? formatDate(newRegEnd) : 'N/A'}`
      );
      return;
    }

    // Resolve section for the bulk batch
    const { sectionId: resolvedSectionId, error: sectionErr } = await resolveSectionForEnrollment(
      gradeId,
      schoolYear,
      sectionId
    );
    if (sectionErr) {
      sendResponse(res, 400, false, sectionErr);
      return;
    }

    const validStudentIds = studentIds.filter((id: string) => mongoose.isValidObjectId(id));
    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < validStudentIds.length; i += 50) {
      const batch = validStudentIds.slice(i, i + 50);
      const batchPromises = batch.map(async (studentId: string) => {
        try {
          const existing = await StudentEnrollment.findOne({ studentId, schoolYear, isActive: true });
          if (existing) {
            errors.push(`Student ${studentId} already enrolled`);
            return null;
          }

          const student = await Student.findById(studentId);
          if (!student) {
            errors.push(`Student ${studentId} not found`);
            return null;
          }

          const enrollment = await StudentEnrollment.create({
            studentId,
            gradeId,
            sectionId: resolvedSectionId,
            schoolYear,
            isActive: true,
          });
          await Student.findByIdAndUpdate(studentId, { enrollmentId: enrollment._id });
          return enrollment;
        } catch (err: any) {
          errors.push(`Student ${studentId}: ${err.message}`);
          return null;
        }
      });

      const results = await Promise.all(batchPromises);
      successCount += results.filter(Boolean).length;
    }

    sendResponse(res, 201, true, `Bulk enrollment completed: ${successCount} successful`, {
      successCount,
      failedCount: studentIds.length - successCount,
      total: studentIds.length,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error in bulk enrollment.', null, error);
  }
};

/**
 * Move a student to a different section within the same grade and school year.
 * PATCH /api/student-enrollment/:id/section
 * Body: { targetSectionId }
 */
export const moveEnrollmentSection = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { targetSectionId } = req.body;

  if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(targetSectionId)) {
    sendResponse(res, 400, false, 'Invalid enrollment ID or targetSectionId');
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      sendResponse(res, 404, false, 'Enrollment not found');
      return;
    }

    const targetSection = await Section.findById(targetSectionId);
    if (!targetSection) {
      sendResponse(res, 404, false, 'Target section not found');
      return;
    }
    if (!targetSection.isActive) {
      sendResponse(res, 400, false, 'Target section is inactive');
      return;
    }
    if (targetSection.gradeId.toString() !== enrollment.gradeId.toString()) {
      sendResponse(res, 400, false, 'Target section belongs to a different grade. Student can only be moved within the same grade and school year.');
      return;
    }
    if (targetSection.schoolYear !== enrollment.schoolYear) {
      sendResponse(res, 400, false, 'Target section belongs to a different school year. Student can only be moved within the same grade and school year.');
      return;
    }
    if (enrollment.sectionId?.toString() === targetSectionId) {
      sendResponse(res, 400, false, 'Student is already assigned to this section');
      return;
    }

    enrollment.sectionId = targetSection._id;
    await enrollment.save();

    const populated = await StudentEnrollment.findById(id)
      .populate('studentId', 'firstName middleName lastName profileImage')
      .populate('gradeId', 'level')
      .populate('sectionId', 'name');

    sendResponse(res, 200, true, 'Student section updated successfully', populated);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error moving student section', null, error);
  }
};

/**
 * Bulk move students to a section within the same grade and school year.
 * POST /api/student-enrollment/bulk-move-section
 * Body: { enrollmentIds: string[], targetSectionId: string }
 */
export const bulkMoveEnrollmentSections = async (req: Request, res: Response): Promise<void> => {
  const { enrollmentIds, targetSectionId } = req.body;

  if (!Array.isArray(enrollmentIds) || enrollmentIds.length === 0 || !mongoose.isValidObjectId(targetSectionId)) {
    sendResponse(res, 400, false, 'enrollmentIds array and valid targetSectionId are required');
    return;
  }

  try {
    const targetSection = await Section.findById(targetSectionId);
    if (!targetSection) {
      sendResponse(res, 404, false, 'Target section not found');
      return;
    }
    if (!targetSection.isActive) {
      sendResponse(res, 400, false, 'Target section is inactive');
      return;
    }

    let successCount = 0;
    const errors: string[] = [];

    for (const eid of enrollmentIds) {
      if (!mongoose.isValidObjectId(eid)) {
        errors.push(`Invalid ID: ${eid}`);
        continue;
      }
      const enrollment = await StudentEnrollment.findById(eid);
      if (!enrollment) {
        errors.push(`Enrollment ${eid} not found`);
        continue;
      }
      if (enrollment.gradeId.toString() !== targetSection.gradeId.toString()) {
        errors.push(`Enrollment ${eid} belongs to a different grade`);
        continue;
      }
      if (enrollment.schoolYear !== targetSection.schoolYear) {
        errors.push(`Enrollment ${eid} belongs to a different school year`);
        continue;
      }
      enrollment.sectionId = targetSection._id;
      await enrollment.save();
      successCount++;
    }

    sendResponse(res, 200, true, `Bulk move completed: ${successCount} moved`, {
      successCount,
      failedCount: enrollmentIds.length - successCount,
      total: enrollmentIds.length,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error in bulk section move', null, error);
  }
};