import { Request, Response } from 'express';
import { Observation } from '../models/observation.model';
import { Student } from '../models/student.model';
import UserAccount from '../models/userAccount.model'; 
import mongoose from 'mongoose';
import { StudentEnrollment } from '../models/studentEnrollment.model';
import { AttributeCategory } from '../models/attributeCategory.model';

export const getAllObservations = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, studentId, teacherId, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (studentId && mongoose.isValidObjectId(studentId)) filter.studentId = studentId;
  if (teacherId && mongoose.isValidObjectId(teacherId)) filter.teacherId = teacherId;
  if (category) {
  if (!mongoose.isValidObjectId(category)) {
    res.status(400).json({ message: 'Invalid category ID' });
    return;
  }
  }

  try {
    const attributeCategory = await AttributeCategory.findById(category);
    if (!attributeCategory) {
      res.status(404).json({ message: 'AttributeCategory not found' });
      return;
    }
    filter.category = category;
    const observations = await Observation.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await Observation.countDocuments(filter);

    res.status(200).json({ 
        data: observations, 
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching observations.', error });
  }
};

export const getObservationById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid observation ID' });
    return;
  }

  try {
    const observation = await Observation.findById(id);
    if (!observation) {
      res.status(404).json({ message: 'Observation not found.' });
      return;
    }
    res.status(200).json({ data: observation });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching observation.', error });
  }
};

export const createObservation = async (req: Request, res: Response): Promise<void> => {
  const { studentId, teacherId, date, category, description, score } = req.body;

  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(teacherId)) {
    res.status(400).json({ message: 'Invalid studentId or teacherId' });
    return;
  }
  if (!date || !category || !description || !score) {
    res.status(400).json({ message: 'Missing required fields: date, category, description, or score' });
    return;
  }
  if (!mongoose.isValidObjectId(category)) {
    res.status(400).json({ message: 'Invalid category ID' });
    return;
  }

  try {
    const attributeCategory = await AttributeCategory.findById(category);
    if (!attributeCategory) {
      res.status(404).json({ message: 'AttributeCategory not found' });
      return;
    }
    if (score < attributeCategory.minScore || score > attributeCategory.maxScore) {
      res.status(400).json({ message: `Score must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}` });
      return;
    }
    const student = await Student.findById(studentId);
    if (!student) {
      res.status(404).json({ message: 'Student not found.' });
      return;
    }
    const teacher = await UserAccount.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      res.status(404).json({ message: 'Teacher not found or invalid role.' });
      return;
    }

    const observation = await Observation.create({ 
      studentId, 
      teacherId, 
      date: new Date(date), 
      category, 
      description,
      score
    });

    res.status(201).json({ message: 'Observation created successfully.', data: observation });
  } catch (error) {
    res.status(500).json({ message: 'Server error creating observation.', error });
  }
};

export const updateObservation = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { date, category, description, score } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid observation ID' });
    return;
  }

  if (!date && !category && !description && score === undefined) {
    res.status(400).json({ message: 'At least one field (date, category, description, score) required.' });
    return;
  }

  if (category) {
  if (!mongoose.isValidObjectId(category)) {
    res.status(400).json({ message: 'Invalid category ID' });
    return;
  }}

  try {

  const attributeCategory = await AttributeCategory.findById(category);
  if (!attributeCategory) {
    res.status(404).json({ message: 'AttributeCategory not found' });
    return;
  }
  if (score !== undefined && (score < attributeCategory.minScore || score > attributeCategory.maxScore)) {
    res.status(400).json({ message: `Score must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}` });
    return;
  }

    const observation = await Observation.findById(id);
    if (!observation) {
      res.status(404).json({ message: 'Observation not found.' });
      return;
    }

    const updateData: any = {};
    if (date) updateData.date = new Date(date);
    if (category) updateData.category = category;
    if (description) updateData.description = description;
    if (score !== undefined) updateData.score = score;

    const updated = await Observation.findByIdAndUpdate(id, updateData, { new: true });
    res.status(200).json({ message: 'Observation updated successfully.', data: updated });
  } catch (error) {
    res.status(500).json({ message: 'Server error updating observation.', error });
  }
};

export const deleteObservation = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid observation ID' });
    return;
  }

  try {
    const observation = await Observation.findById(id);
    if (!observation) {
      res.status(404).json({ message: 'Observation not found.' });
      return;
    }

    await Observation.findByIdAndDelete(id);
    res.status(200).json({ message: 'Observation deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting observation.', error });
  }
};



export const getObservationsByStudentAndDate = async (req: Request, res: Response): Promise<void> => {
    const { studentId } = req.params;
    const { startDate, endDate, category } = req.query;

    if (!mongoose.isValidObjectId(studentId)) {
    res.status(400).json({ message: 'Invalid studentId' });
    return;
    }
    if (!startDate || !endDate) {
        res.status(400).json({ message: 'Missing required fields: startDate or endDate' });
        return;
    }
    
    const filter: any = {studentId, 
        date: {
            $gte : new Date( startDate as string ),
            $lt : new Date ( endDate as string )
        }
    }

    if (category) {
    if (!mongoose.isValidObjectId(category)) {
        res.status(400).json({ message: 'Invalid category ID' });
        return;
      }
    }

    try{
      const attributeCategory = await AttributeCategory.findById(category);
      if (!attributeCategory) {
        res.status(404).json({ message: 'AttributeCategory not found' });
        return;
      }
      filter.category = category;
      const observations = await Observation.find(filter).sort({ date: -1 });
      res.status(200).json({ data: observations, count: observations.length });
    }catch(error){
        res.status(500).json({message : "Server error"})
    }
}



export const getObservationsByTeacher = async (req: Request, res: Response): Promise<void> => {
  const { teacherId } = req.params;
  const { page = 1, limit = 10, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId)) {
    res.status(400).json({ message: 'Invalid teacherId' });
    return;
  }

  const filter: any = { teacherId };
  if (category) {
  if (!mongoose.isValidObjectId(category)) {
    res.status(400).json({ message: 'Invalid category ID' });
    return;
  }
  }
  try {
    const attributeCategory = await AttributeCategory.findById(category);
    if (!attributeCategory) {
      res.status(404).json({ message: 'AttributeCategory not found' });
      return;
    }
  filter.category = category;
    const observations = await Observation.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await Observation.countDocuments(filter);

    res.status(200).json({ 
      data: observations, 
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching teacher observations.', error });
  }
};

export const bulkDeleteObservationsByStudent = async (req: Request, res: Response): Promise<void> => {
  const { studentId } = req.params;

  if (!mongoose.isValidObjectId(studentId)) {
    res.status(400).json({ message: 'Invalid studentId' });
    return;
  }

  try {
    const student = await Student.findById(studentId);
    if (!student) {
      res.status(404).json({ message: 'Student not found.' });
      return;
    }

    const result = await Observation.deleteMany({ studentId });
    res.status(200).json({ message: `Deleted ${result.deletedCount} observations successfully.` });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting observations.', error });
  }
};


export const getObservationsByTeacherAndGrade = async (req: Request, res: Response): Promise<void> => {
  const { teacherId, gradeId } = req.params;
  const { page = 1, limit = 10, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId) || !mongoose.isValidObjectId(gradeId)) {
    res.status(400).json({ message: 'Invalid teacherId or gradeId' });
    return;
  }

  try {
    const teacher = await UserAccount.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      res.status(404).json({ message: 'Teacher not found or invalid role.' });
      return;
    }

    const enrollments = await StudentEnrollment.find({ gradeId, isActive: true }).select('studentId');
    const studentIds = enrollments.map(enrollment => enrollment.studentId);

    if (!studentIds.length) {
      res.status(200).json({ data: [], page: Number(page), limit: Number(limit), total: 0, pages: 0 });
      return;
    }

    const filter: any = { teacherId, studentId: { $in: studentIds } };
  if (category) {
  if (!mongoose.isValidObjectId(category)) {
    res.status(400).json({ message: 'Invalid category ID' });
    return;
  }
  const attributeCategory = await AttributeCategory.findById(category);
  if (!attributeCategory) {
    res.status(404).json({ message: 'AttributeCategory not found' });
    return;
  }
  filter.category = category;
}

    const observations = await Observation.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await Observation.countDocuments(filter);

    res.status(200).json({ 
      data: observations, 
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching observations by teacher and grade.', error });
  }
};



export const getObservationsByCategoryAndGrade = async (req: Request, res: Response): Promise<void> => {
  const { gradeId } = req.params;
  const { category, page = 1, limit = 10 } = req.query;
  const teacherId = (req as any).user?._id;

  if (!mongoose.isValidObjectId(gradeId)) {
    res.status(400).json({ message: 'Invalid gradeId' });
    return;
  }
  if (!mongoose.isValidObjectId(teacherId)) {
    res.status(400).json({ message: 'Invalid teacherId from token' });
    return;
  }
  if (!category) {
  res.status(400).json({ message: 'Category is required' });
  return;
  }
  if (!mongoose.isValidObjectId(category)) {
    res.status(400).json({ message: 'Invalid category ID' });
    return;
  }


  try {
  const attributeCategory = await AttributeCategory.findById(category);
  if (!attributeCategory) {
    res.status(400).json({ message: 'AttributeCategory not found' });
    return;
  }
    const teacher = await UserAccount.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      res.status(404).json({ message: 'Teacher not found or invalid role.' });
      return;
    }

    const enrollments = await StudentEnrollment.find({ gradeId, isActive: true }).select('studentId');
    const studentIds = enrollments.map(enrollment => enrollment.studentId);

    if (!studentIds.length) {
      res.status(200).json({ data: [], page: Number(page), limit: Number(limit), total: 0, pages: 0 });
      return;
    }

    const filter: any = { teacherId, studentId: { $in: studentIds }, category };
    const skip = (Number(page) - 1) * Number(limit);

    const observations = await Observation.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await Observation.countDocuments(filter);

    res.status(200).json({ 
      data: observations, 
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching observations by category and grade.', error });
  }
};