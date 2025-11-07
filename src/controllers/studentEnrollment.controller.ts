import { Request, Response } from 'express';
import { StudentEnrollment } from '../models/studentEnrollment.model.ts';
import { Student } from '../models/student.model.ts';
import mongoose from 'mongoose';
import { sendResponse } from '../utils/sendResponse.util.ts';

const getCurrentSchoolYear = (): string => {
  const now = new Date()
  const month = now.getMonth()
  const year = now.getFullYear()
  return month >= 6 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

export const getAllEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, schoolYear, isActive } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = { isActive: true };
  if (schoolYear) filter.schoolYear = schoolYear;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  try {
    const enrollments = await StudentEnrollment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await StudentEnrollment.countDocuments(filter);

    sendResponse(res, 200, true, 'Enrollments fetched successfully', enrollments, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching enrollments.', null, error);
  }
};

export const getStudentEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { schoolYear, isActive } = req.query;

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId');
    return;
  }

  const filter: any = { studentId };
  if (schoolYear) filter.schoolYear = schoolYear;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  try {
    const enrollments = await StudentEnrollment.find(filter).sort({ schoolYear: -1 });
    sendResponse(res, 200, true, 'Student enrollments fetched successfully', {
      enrollments,
      count: enrollments.length
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching student enrollments.', null, error);
  }
};

export const getEnrollmentById = async (req: Request, res: Response): Promise<void> => {
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
    sendResponse(res, 200, true, 'Enrollment fetched successfully', enrollment);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching enrollment.', null, error);
  }
};


export const createEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { studentId, gradeId, schoolYear: providedYear } = req.body;

  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid studentId or gradeId');
    return;
  }

  const schoolYear = providedYear || getCurrentSchoolYear();

  try {
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

    const enrollment = await StudentEnrollment.create({ studentId, gradeId, schoolYear, isActive: true });
    await Student.findByIdAndUpdate(studentId, { enrollmentId: enrollment._id });

    sendResponse(res, 201, true, 'Enrollment created successfully.', enrollment);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error creating enrollment.', null, error);
  }
};

export const updateEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { gradeId, schoolYear: providedYear, isActive } = req.body;

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

    const updateData: any = {};
    if (gradeId) updateData.gradeId = gradeId;
    if (providedYear) updateData.schoolYear = providedYear;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await StudentEnrollment.findByIdAndUpdate(id, updateData, { new: true });
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

    const updated = await StudentEnrollment.findByIdAndUpdate(id, { isActive: newStatus }, { new: true });
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

export const getGradeEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { gradeId } = req.params;
  const { schoolYear, isActive = 'true' } = req.query;

  if (!mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid gradeId');
    return;
  }

  const filter: any = { gradeId, isActive: isActive === 'true' };
  if (schoolYear) filter.schoolYear = schoolYear;

  try {
    const enrollments = await StudentEnrollment.find(filter).sort({ createdAt: -1 });
    sendResponse(res, 200, true, 'Grade enrollments fetched successfully', {
      enrollments,
      count: enrollments.length
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching grade enrollments.', null, error);
  }
};

export const bulkCreateEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { studentIds, gradeId, schoolYear: providedYear } = req.body;

  if (!Array.isArray(studentIds) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid studentIds array or gradeId');
    return;
  }

  const schoolYear = providedYear || getCurrentSchoolYear();
  const validStudentIds = studentIds.filter((id: string) => mongoose.isValidObjectId(id));
  let successCount = 0;
  const errors: string[] = [];

  try {
    for (let i = 0; i < validStudentIds.length; i += 50) {
      const batch = validStudentIds.slice(i, i + 50);
      const batchPromises = batch.map(async (studentId: string) => {
        try {
          const existing = await StudentEnrollment.findOne({ studentId, schoolYear, isActive: true });
          if (existing) { errors.push(`Student ${studentId} already enrolled`); return null; }

          const student = await Student.findById(studentId);
          if (!student) { errors.push(`Student ${studentId} not found`); return null; }

          const enrollment = await StudentEnrollment.create({ studentId, gradeId, schoolYear, isActive: true });
          await Student.findByIdAndUpdate(studentId, { enrollmentId: enrollment._id });
          return enrollment;
        } catch (err: any) { errors.push(`Student ${studentId}: ${err.message}`); return null; }
      });

      const results = await Promise.all(batchPromises);
      successCount += results.filter(Boolean).length;
    }

    sendResponse(res, 201, true, `Bulk enrollment completed: ${successCount} successful`, {
      successCount, 
      failedCount: studentIds.length - successCount, 
      total: studentIds.length, 
      errors: errors.slice(0, 10)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error in bulk enrollment.', null, error);
  }
};