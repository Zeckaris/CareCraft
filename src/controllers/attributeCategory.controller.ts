import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AttributeCategory } from '../models/attributeCategory.model';
import { Observation } from '../models/observation.model';
import { FlaggedIssue } from '../models/flaggedIssue.model';

export const getAllAttributeCategories = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, name } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (name) {
    filter.name = { $regex: name as string, $options: 'i' }; 
  }

  try {
    const categories = await AttributeCategory.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await AttributeCategory.countDocuments(filter);

    res.status(200).json({
      data: categories,
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching attribute categories.', error });
  }
};

export const getAttributeCategoryById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid attribute category ID' });
    return;
  }

  try {
    const category = await AttributeCategory.findById(id);
    if (!category) {
      res.status(404).json({ message: 'AttributeCategory not found.' });
      return;
    }
    res.status(200).json({ data: category });
  } catch (error) {
    res.status(500).json({ message: 'Server error fetching attribute category.', error });
  }
};

export const createAttributeCategory = async (req: Request, res: Response): Promise<void> => {
  const { name, description, minScore, maxScore } = req.body;

  if (!name || !minScore || !maxScore) {
    res.status(400).json({ message: 'Missing required fields: name, minScore, or maxScore' });
    return;
  }
  if (minScore >= maxScore) {
    res.status(400).json({ message: 'minScore must be less than maxScore' });
    return;
  }

  try {
    const existingCategory = await AttributeCategory.findOne({ name });
    if (existingCategory) {
      res.status(400).json({ message: 'Attribute category name already exists.' });
      return;
    }

    const category = await AttributeCategory.create({
      name,
      description: description || '',
      minScore,
      maxScore
    });

    res.status(201).json({ message: 'Attribute category created successfully.', data: category });
  } catch (error) {
    res.status(500).json({ message: 'Server error creating attribute category.', error });
  }
};

export const updateAttributeCategory = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, description, minScore, maxScore } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid attribute category ID' });
    return;
  }
  if (!name && !description && minScore === undefined && maxScore === undefined) {
    res.status(400).json({ message: 'At least one field (name, description, minScore, maxScore) required.' });
    return;
  }
  if (minScore !== undefined && maxScore !== undefined && minScore >= maxScore) {
    res.status(400).json({ message: 'minScore must be less than maxScore' });
    return;
  }

  try {
    const category = await AttributeCategory.findById(id);
    if (!category) {
      res.status(404).json({ message: 'AttributeCategory not found.' });
      return;
    }

    if (name && name !== category.name) {
      const existingCategory = await AttributeCategory.findOne({ name });
      if (existingCategory) {
        res.status(400).json({ message: 'Attribute category name already exists.' });
        return;
      }
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (minScore !== undefined) updateData.minScore = minScore;
    if (maxScore !== undefined) updateData.maxScore = maxScore;

    const updated = await AttributeCategory.findByIdAndUpdate(id, updateData, { new: true });
    res.status(200).json({ message: 'Attribute category updated successfully.', data: updated });
  } catch (error) {
    res.status(500).json({ message: 'Server error updating attribute category.', error });
  }
};

export const deleteAttributeCategory = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid attribute category ID' });
    return;
  }

  try {
    const category = await AttributeCategory.findById(id);
    if (!category) {
      res.status(404).json({ message: 'AttributeCategory not found.' });
      return;
    }

    const observationCount = await Observation.countDocuments({ category: id });
    const flaggedIssueCount = await FlaggedIssue.countDocuments({ linkedAttribute: id });
    const dependencies = [];
    if (observationCount > 0) dependencies.push(`${observationCount} observation(s)`);
    if (flaggedIssueCount > 0) dependencies.push(`${flaggedIssueCount} flagged issue(s)`);
    if (dependencies.length > 0) {
      res.status(400).json({ message: `Cannot delete category; it is used by: ${dependencies.join(', ')}.` });
      return;
    }

    await AttributeCategory.findByIdAndDelete(id);
    res.status(200).json({ message: 'Attribute category deleted successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error deleting attribute category.', error });
  }
};