import { Request, Response } from 'express';
import { Observation } from '../models/observation.model';
import { Student } from '../models/student.model';
import UserAccount from '../models/userAccount.model'; 
import mongoose from 'mongoose';
import { StudentEnrollment } from '../models/studentEnrollment.model';
import { AttributeCategory } from '../models/attributeCategory.model';
import { sendResponse } from '../utils/sendResponse.util';

export const getAllObservations = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, studentId, teacherId, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (studentId && mongoose.isValidObjectId(studentId)) filter.studentId = studentId;
  if (teacherId && mongoose.isValidObjectId(teacherId)) filter.teacherId = teacherId;
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

    sendResponse(res, 200, true, 'Observations fetched successfully', observations, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching observations.', null, error);
  }
};

export const getObservationById = async (req: Request, res: Response): Promise<void> => {
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
    sendResponse(res, 200, true, 'Observation fetched successfully', observation);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching observation.', null, error);
  }
};

export const createObservation = async (req: Request, res: Response): Promise<void> => {
  const { studentId, teacherId, date, category, description, score } = req.body;

  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid studentId or teacherId');
    return;
  }
  if (!date || !category || !description || !score) {
    sendResponse(res, 400, false, 'Missing required fields: date, category, description, or score');
    return;
  }
  if (!mongoose.isValidObjectId(category)) {
    sendResponse(res, 400, false, 'Invalid category ID');
    return;
  }

  try {
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
    const teacher = await UserAccount.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      sendResponse(res, 404, false, 'Teacher not found or invalid role.');
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

    // Populate the created observation for response
    const populatedObservation = await Observation.findById(observation._id)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore');

    sendResponse(res, 201, true, 'Observation created successfully.', populatedObservation);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error creating observation.', null, error);
  }
};

export const updateObservation = async (req: Request, res: Response): Promise<void> => {
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
    if (category) {
      const attributeCategory = await AttributeCategory.findById(category);
      if (!attributeCategory) {
        sendResponse(res, 404, false, 'AttributeCategory not found');
        return;
      }
    }

    const observation = await Observation.findById(id);
    if (!observation) {
      sendResponse(res, 404, false, 'Observation not found.');
      return;
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
  } catch (error) {
    sendResponse(res, 500, false, 'Server error updating observation.', null, error);
  }
};

export const deleteObservation = async (req: Request, res: Response): Promise<void> => {
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

    await Observation.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Observation deleted successfully.');
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting observation.', null, error);
  }
};

export const getObservationsByStudentAndDate = async (req: Request, res: Response): Promise<void> => {
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

  try {
    const observations = await Observation.find(filter)
      .populate('teacherId', 'firstName lastName')
      .populate('studentId', 'firstName lastName')
      .populate('category', 'name minScore maxScore')
      .sort({ date: -1 });
    
    sendResponse(res, 200, true, 'Observations fetched successfully', observations);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching observations', null, error);
  }
};

export const getObservationsByTeacher = async (req: Request, res: Response): Promise<void> => {
  const { teacherId } = req.params;
  const { page = 1, limit = 10, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId');
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

export const bulkDeleteObservationsByStudent = async (req: Request, res: Response): Promise<void> => {
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

export const getObservationsByTeacherAndGrade = async (req: Request, res: Response): Promise<void> => {
  const { teacherId, gradeId } = req.params;
  const { page = 1, limit = 10, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  if (!mongoose.isValidObjectId(teacherId) || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid teacherId or gradeId');
    return;
  }

  try {
    const teacher = await UserAccount.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      sendResponse(res, 404, false, 'Teacher not found or invalid role.');
      return;
    }

    const enrollments = await StudentEnrollment.find({ gradeId, isActive: true }).select('studentId');
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

export const getObservationsByCategoryAndGrade = async (req: Request, res: Response): Promise<void> => {
  const { gradeId } = req.params;
  const { category, page = 1, limit = 10 } = req.query;
  const teacherId = (req as any).user?._id;

  if (!mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid gradeId');
    return;
  }
  if (!mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid teacherId from token');
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

    const teacher = await UserAccount.findOne({ _id: teacherId, role: 'teacher' });
    if (!teacher) {
      sendResponse(res, 404, false, 'Teacher not found or invalid role.');
      return;
    }

    const enrollments = await StudentEnrollment.find({ gradeId, isActive: true }).select('studentId');
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