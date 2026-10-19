import { Request, Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { StudentEnrollment } from '../models/studentEnrollment.model.js';
import { Student } from '../models/student.model.js';
import { Section } from '../models/section.model.js';
import { Grade } from '../models/grade.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import {
  assertTeacherCanReadStudent,
  assertParentOwnsStudent,
  getTeacherSectionIds,
} from '../middlewares/access.middleware.js';
import { yearsMatch, getYearVariants, normalizeYear } from '../utils/yearNormalizer.js';
import {
  getOpenRegistrationCalendarWindows,
  resolveRegistrationTarget,
} from '../service/registrationWindow.service.js';

interface RegistrationOverride {
  reason: string;
  by: Types.ObjectId;
  at: Date;
}

function parseRegistrationOverride(
  req: AuthRequest,
  body: any
):
  | { ok: true; override: boolean; record: RegistrationOverride | null }
  | { ok: false; status: 400 | 403; message: string } {
  if (body?.overrideRegistrationWindow !== true) {
    return { ok: true, override: false, record: null };
  }
  if (req.user?.role !== 'admin') {
    return {
      ok: false,
      status: 403,
      message: 'Only an admin can override the registration window.',
    };
  }
  const reason = typeof body?.overrideReason === 'string' ? body.overrideReason.trim() : '';
  if (!reason) {
    return {
      ok: false,
      status: 400,
      message: 'overrideReason is required when overrideRegistrationWindow is true.',
    };
  }
  return {
    ok: true,
    override: true,
    record: {
      reason,
      by: new Types.ObjectId(String(req.user.id)),
      at: new Date(),
    },
  };
}

/**
 * Resolves the sectionId for an enrollment.
 *
 * Sections are generated AFTER enrollment (from unassigned students), so a
 * section is optional at creation time:
 * - If an explicit sectionId is supplied, it must exist, be active, and belong
 *   to the same grade and school year as the enrollment.
 * - If it is omitted, the enrollment is created with no section (sectionId null).
 */
export const resolveSectionForEnrollment = async (
  gradeId: any,
  schoolYear: string,
  explicitSectionId?: any
): Promise<{ sectionId?: Types.ObjectId; error?: string }> => {
  if (explicitSectionId === undefined || explicitSectionId === null || explicitSectionId === '') {
    return {};
  }

  if (!mongoose.isValidObjectId(explicitSectionId)) {
    return { error: 'Invalid sectionId' };
  }
  const section = await Section.findById(explicitSectionId);
  if (!section) {
    return { error: 'Section not found' };
  }
  if (!section.isActive) {
    return { error: 'Cannot enroll in an inactive section' };
  }
  if (section.gradeId.toString() !== gradeId.toString()) {
    return { error: 'Section does not belong to the selected grade' };
  }
  if (!yearsMatch(section.schoolYear, schoolYear)) {
    return { error: `Section belongs to school year ${section.schoolYear}, but enrollment is for ${schoolYear}` };
  }
  return { sectionId: section._id };
};

export const getAllEnrollments = async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 10, gradeId, schoolYear, isActive, search, sectionId, section } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (gradeId) filter.gradeId = gradeId;
  if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear as string) };
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
  if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear as string) };
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

export const createEnrollment = async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body ?? {};
  const { studentId, gradeId, sectionId, schoolYear: requestedYear } = body;

  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid studentId or gradeId');
    return;
  }

  const override = parseRegistrationOverride(req, body);
  if (!override.ok) {
    sendResponse(res, override.status, false, override.message);
    return;
  }

  try {
    const student = await Student.findById(studentId);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found.');
      return;
    }

    const registration = await resolveRegistrationTarget({
      studentId,
      requestedYear,
      override: override.override,
    });
    if (!registration.ok) {
      sendResponse(res, registration.status, false, registration.message);
      return;
    }

    const schoolYear = registration.schoolYear;

    const existing = await StudentEnrollment.findOne({
      studentId,
      schoolYear: { $in: getYearVariants(schoolYear) },
      isActive: true,
    });
    if (existing) {
      sendResponse(res, 400, false, `Student already has active enrollment for ${schoolYear}`);
      return;
    }

    const grade = await Grade.findById(gradeId);
    if (!grade) {
      sendResponse(res, 404, false, 'Grade not found.');
      return;
    }

    // Resolve section (optional; validated only when supplied explicitly)
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
      sectionId: resolvedSectionId ?? null,
      schoolYear,
      isActive: true,
      registrationWindowOverride:
        registration.isOverride && override.record ? override.record : null,
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

export const updateEnrollment = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const body = req.body ?? {};
  const { gradeId, schoolYear: providedYear, isActive, sectionId } = body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid enrollment ID');
    return;
  }
  if (gradeId && !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid gradeId');
    return;
  }

  const override = parseRegistrationOverride(req, body);
  if (!override.ok) {
    sendResponse(res, override.status, false, override.message);
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      sendResponse(res, 404, false, 'Enrollment not found.');
      return;
    }

    const targetGradeId = gradeId || enrollment.gradeId;
    const targetSchoolYear = providedYear
      ? normalizeYear(providedYear)
      : enrollment.schoolYear;

    const changingYear = !!providedYear && !yearsMatch(targetSchoolYear, enrollment.schoolYear);
    const changingGrade =
      !!gradeId && String(gradeId) !== String(enrollment.gradeId);
    const reactivating = isActive === true && !enrollment.isActive;
    const needsRegistrationGate = changingYear || changingGrade || reactivating;

    let overrideRecord: RegistrationOverride | null = null;
    if (needsRegistrationGate) {
      const registration = await resolveRegistrationTarget({
        studentId: enrollment.studentId,
        requestedYear: targetSchoolYear,
        override: override.override,
      });
      if (!registration.ok) {
        sendResponse(res, registration.status, false, registration.message);
        return;
      }
      if (registration.isOverride && override.record) {
        overrideRecord = override.record;
      }
    }

    if (isActive !== undefined && isActive !== enrollment.isActive && isActive) {
      await StudentEnrollment.updateMany(
        { studentId: enrollment.studentId, _id: { $ne: id }, isActive: true },
        { isActive: false }
      );
    }

    const updateData: any = {};
    if (gradeId) updateData.gradeId = gradeId;
    if (providedYear) updateData.schoolYear = targetSchoolYear;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (overrideRecord) updateData.registrationWindowOverride = overrideRecord;

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

export const toggleEnrollmentActive = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid enrollment ID');
    return;
  }

  const override = parseRegistrationOverride(req, req.body ?? {});
  if (!override.ok) {
    sendResponse(res, override.status, false, override.message);
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      sendResponse(res, 404, false, 'Enrollment not found.');
      return;
    }

    const newStatus = !enrollment.isActive;
    let overrideRecord: RegistrationOverride | null = null;

    if (newStatus) {
      const registration = await resolveRegistrationTarget({
        studentId: enrollment.studentId,
        requestedYear: enrollment.schoolYear,
        override: override.override,
      });
      if (!registration.ok) {
        sendResponse(res, registration.status, false, registration.message);
        return;
      }
      if (registration.isOverride && override.record) {
        overrideRecord = override.record;
      }

      await StudentEnrollment.updateMany(
        { studentId: enrollment.studentId, _id: { $ne: id }, isActive: true },
        { isActive: false }
      );
    }

    const update: any = { isActive: newStatus };
    if (overrideRecord) update.registrationWindowOverride = overrideRecord;

    const updated = await StudentEnrollment.findByIdAndUpdate(
      id,
      update,
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
  if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear as string) };

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

export const bulkCreateEnrollments = async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body ?? {};
  const { studentIds, gradeId, sectionId, schoolYear: requestedYear } = body;

  if (!Array.isArray(studentIds) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid studentIds array or gradeId');
    return;
  }

  const override = parseRegistrationOverride(req, body);
  if (!override.ok) {
    sendResponse(res, override.status, false, override.message);
    return;
  }

  try {
    const grade = await Grade.findById(gradeId);
    if (!grade) {
      sendResponse(res, 404, false, 'Grade not found.');
      return;
    }

    const validStudentIds = studentIds.filter((id: string) => mongoose.isValidObjectId(id));
    let successCount = 0;
    const errors: string[] = [];

    for (const studentId of validStudentIds) {
      try {
        const student = await Student.findById(studentId);
        if (!student) {
          errors.push(`Student ${studentId} not found`);
          continue;
        }

        const registration = await resolveRegistrationTarget({
          studentId,
          requestedYear,
          override: override.override,
        });
        if (!registration.ok) {
          errors.push(`Student ${studentId}: ${registration.message}`);
          continue;
        }

        const schoolYear = registration.schoolYear;
        const existing = await StudentEnrollment.findOne({
          studentId,
          schoolYear: { $in: getYearVariants(schoolYear) },
          isActive: true,
        });
        if (existing) {
          errors.push(`Student ${studentId} already enrolled`);
          continue;
        }

        const { sectionId: resolvedSectionId, error: sectionErr } =
          await resolveSectionForEnrollment(gradeId, schoolYear, sectionId);
        if (sectionErr) {
          errors.push(`Student ${studentId}: ${sectionErr}`);
          continue;
        }

        const enrollment = await StudentEnrollment.create({
          studentId,
          gradeId,
          sectionId: resolvedSectionId ?? null,
          schoolYear,
          isActive: true,
          registrationWindowOverride:
            registration.isOverride && override.record ? override.record : null,
        });
        await Student.findByIdAndUpdate(studentId, { enrollmentId: enrollment._id });
        successCount++;
      } catch (err: any) {
        errors.push(`Student ${studentId}: ${err.message}`);
      }
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
 * GET /api/enrollment/registration-windows
 * Returns both registration windows for every calendar that has not ended.
 */
export const getRegistrationWindows = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = await getOpenRegistrationCalendarWindows();
    sendResponse(res, 200, true, 'Registration windows fetched successfully', data);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching registration windows.', null, error);
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
    if (!yearsMatch(targetSection.schoolYear, enrollment.schoolYear)) {
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
      if (!yearsMatch(enrollment.schoolYear, targetSection.schoolYear)) {
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

/**
 * List active enrollments of a grade (and optionally school year) that have no
 * section assigned yet.
 * GET /api/enrollment/unassigned?gradeId=&schoolYear=
 */
export const getUnassignedEnrollments = async (req: AuthRequest, res: Response): Promise<void> => {
  const { gradeId, schoolYear } = req.query;

  if (!gradeId || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Valid gradeId is required');
    return;
  }

  const filter: any = {
    gradeId,
    isActive: true,
    $or: [{ sectionId: null }, { sectionId: { $exists: false } }],
  };
  if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear as string) };

  try {
    const enrollments = await StudentEnrollment.find(filter)
      .populate('studentId', 'firstName middleName lastName profileImage gender')
      .populate('gradeId', 'level')
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, 'Unassigned enrollments fetched successfully', {
      enrollments,
      count: enrollments.length,
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching unassigned enrollments.', null, error);
  }
};