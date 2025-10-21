import { Request, Response } from 'express';
import { Observation } from '../models/observation.model';
import { Student } from '../models/student.model';
import UserAccount from '../models/userAccount.model'; 
import mongoose from 'mongoose';

export const getAllObservations = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, studentId, teacherId, category } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (studentId && mongoose.isValidObjectId(studentId)) filter.studentId = studentId;
  if (teacherId && mongoose.isValidObjectId(teacherId)) filter.teacherId = teacherId;
  if (category) filter.category = category;

  try {
    const observations = await Observation.find(filter)
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await Observation.countDocuments(filter);

    res.status(200).json({ 
      data: observations, 
      pagination: { 
        page: Number(page), 
        limit: Number(limit), 
        total, 
        pages: Math.ceil(total / Number(limit)) 
      } 
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
  const { studentId, teacherId, date, category, description } = req.body;

  if (!mongoose.isValidObjectId(studentId) || !mongoose.isValidObjectId(teacherId)) {
    res.status(400).json({ message: 'Invalid studentId or teacherId' });
    return;
  }
  if (!date || !category || !description) {
    res.status(400).json({ message: 'Missing required fields: date, category, or description' });
    return;
  }

  try {
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
      description 
    });

    res.status(201).json({ message: 'Observation created successfully.', data: observation });
  } catch (error) {
    res.status(500).json({ message: 'Server error creating observation.', error });
  }
};

export const updateObservation = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { date, category, description } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid observation ID' });
    return;
  }
  if (!date && !category && !description) {
    res.status(400).json({ message: 'At least one field (date, category, description) required.' });
    return;
  }

  try {
    const observation = await Observation.findById(id);
    if (!observation) {
      res.status(404).json({ message: 'Observation not found.' });
      return;
    }

    const updateData: any = {};
    if (date) updateData.date = new Date(date);
    if (category) updateData.category = category;
    if (description) updateData.description = description;

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