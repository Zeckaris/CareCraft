import { Request, Response } from 'express';
import { StudentEnrollment } from '../models/studentEnrollment.model.js';
import { Student } from '../models/student.model.js';
import { AcademicCalendar } from '../models/academicCalendar.model.js'; // NEW: added this import
import mongoose from 'mongoose';
import { sendResponse } from '../utils/sendResponse.util.js';

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

export const getAllEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, gradeId, schoolYear, isActive, search } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (gradeId) filter.gradeId = gradeId;
  if (schoolYear) filter.schoolYear = schoolYear;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  try {
    let query = StudentEnrollment.find(filter)
      .populate('studentId', 'firstName middleName lastName profileImage')
      .populate('gradeId', 'level')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    if (search) {
      const students = await Student.find({
        $or: [
          { firstName: { $regex: search, $options: 'i' } },
          { middleName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
        ]
      }).select('_id');

      const studentIds = students.map(s => s._id);
      if (studentIds.length === 0) {
        sendResponse(res, 200, true, 'Enrollments fetched successfully', [], null, {
          total: 0,
          page: Number(page),
          limit: Number(limit)
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
  const { studentId, gradeId } = req.body;

  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid studentId or gradeId');
    return;
  }

  try {
    // NEW: Fetch current active calendar
    const currentCalendar = await getCurrentActiveCalendar();
    if (!currentCalendar) {
       sendResponse(res, 400, false, 'No active academic calendar found. Please set one first.');
       return;
    }

    // NEW: Force schoolYear to current active calendar's value
    const schoolYear = currentCalendar.academicYear;

    // NEW: Check registration period (today must be between general start and new student end)
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
  const { studentIds, gradeId } = req.body;

  if (!Array.isArray(studentIds) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid studentIds array or gradeId');
    return;
  }

  try {
    // NEW: Fetch current active calendar
    const currentCalendar = await getCurrentActiveCalendar();
    if (!currentCalendar) {
      sendResponse(res, 400, false, 'No active academic calendar found. Please set one first.');
      return;
    }

    // NEW: Force schoolYear to current active calendar's value
    const schoolYear = currentCalendar.academicYear;

    // NEW: Check registration period (today must be between general start and new student end)
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

    const validStudentIds = studentIds.filter((id: string) => mongoose.isValidObjectId(id));
    let successCount = 0;
    const errors: string[] = [];

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