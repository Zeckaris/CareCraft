import { Request, Response } from 'express';
import { StudentEnrollment } from '../models/studentEnrollment.model';
import { Student } from '../models/student.model';
import mongoose from 'mongoose';




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

    res.status(200).json({ 
      data: enrollments, 
      pagination: { 
        page: Number(page), 
        limit: Number(limit), 
        total, 
        pages: Math.ceil(total / Number(limit)) 
      } 
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching enrollments.', error });
  }
};

export const getStudentEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { studentId } = req.params;
  const { schoolYear, isActive } = req.query;

  if (!mongoose.isValidObjectId(studentId)) {
    res.status(400).json({ message: 'Invalid studentId' });
    return;
  }

  const filter: any = { studentId };
  if (schoolYear) filter.schoolYear = schoolYear;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  try {
    const enrollments = await StudentEnrollment.find(filter).sort({ schoolYear: -1 });
    res.status(200).json({ data: enrollments, count: enrollments.length });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching student enrollments.', error });
  }
};

export const getEnrollmentById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid enrollment ID' });
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      res.status(404).json({ message: 'Enrollment not found.' });
      return;
    }
    res.status(200).json({ data: enrollment });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching enrollment.', error });
  }
};

export const createEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { studentId, gradeId, schoolYear: providedYear } = req.body;

  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(gradeId)) {
    res.status(400).json({ message: 'Invalid studentId or gradeId' });
    return;
  }

  const schoolYear = providedYear || getCurrentSchoolYear();

  try {
    const existing = await StudentEnrollment.findOne({ studentId, schoolYear, isActive: true });
    if (existing) {
      res.status(400).json({ message: `Student already has active enrollment for ${schoolYear}` });
      return;
    }

    const student = await Student.findById(studentId);
    if (!student) {
      res.status(404).json({ message: 'Student not found.' });
      return;
    }

    const enrollment = await StudentEnrollment.create({ studentId, gradeId, schoolYear, isActive: true });
    await Student.findByIdAndUpdate(studentId, { enrollmentId: enrollment._id });

    res.status(201).json({ message: 'Enrollment created successfully.', data: enrollment });
  } catch (error) {
    res.status(500).json({ message: 'Server error creating enrollment.', error });
  }
};

export const updateEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { gradeId, schoolYear: providedYear, isActive } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid enrollment ID' });
    return;
  }
  if (gradeId && !mongoose.isValidObjectId(gradeId)) {
    res.status(400).json({ message: 'Invalid gradeId' });
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      res.status(404).json({ message: 'Enrollment not found.' });
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
    res.status(200).json({ message: 'Enrollment updated successfully.', data: updated });
  } catch (error) {
    res.status(500).json({ message: 'Server error updating enrollment.', error });
  }
};

export const toggleEnrollmentActive = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid enrollment ID' });
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      res.status(404).json({ message: 'Enrollment not found.' });
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
    res.status(200).json({ 
      message: `Enrollment ${newStatus ? 'activated' : 'deactivated'} successfully.`, 
      data: updated 
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error toggling enrollment.', error });
  }
};

export const deleteEnrollment = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid enrollment ID' });
    return;
  }

  try {
    const enrollment = await StudentEnrollment.findById(id);
    if (!enrollment) {
      res.status(404).json({ message: 'Enrollment not found.' });
      return;
    }

    await Student.findByIdAndUpdate(enrollment.studentId, { enrollmentId: null });
    await StudentEnrollment.findByIdAndDelete(id);

    res.status(200).json({ message: 'Enrollment deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting enrollment.', error });
  }
};

export const getGradeEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { gradeId } = req.params;
  const { schoolYear, isActive = 'true' } = req.query;

  if (!mongoose.isValidObjectId(gradeId)) {
    res.status(400).json({ message: 'Invalid gradeId' });
    return;
  }

  const filter: any = { gradeId, isActive: isActive === 'true' };
  if (schoolYear) filter.schoolYear = schoolYear;

  try {
    const enrollments = await StudentEnrollment.find(filter).sort({ createdAt: -1 });
    res.status(200).json({ data: enrollments, count: enrollments.length });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching grade enrollments.', error });
  }
};

export const bulkCreateEnrollments = async (req: Request, res: Response): Promise<void> => {
  const { studentIds, gradeId, schoolYear: providedYear } = req.body;

  if (!Array.isArray(studentIds) || !mongoose.isValidObjectId(gradeId)) {
    res.status(400).json({ message: 'Invalid studentIds array or gradeId' });
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

    res.status(201).json({ 
      message: `Bulk enrollment completed: ${successCount} successful`,
      data: { 
        successCount, 
        failedCount: studentIds.length - successCount, 
        total: studentIds.length, 
        errors: errors.slice(0, 10) 
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error in bulk enrollment.', error });
  }
};
