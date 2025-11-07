import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { AttributeCategory } from '../models/attributeCategory.model.ts';
import { Observation } from '../models/observation.model.ts';
import { FlaggedIssue } from '../models/flaggedIssue.model.ts';
import { sendResponse } from '../utils/sendResponse.util.ts';

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

    sendResponse(res, 200, true, 'Attribute categories fetched successfully', categories, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching attribute categories.', null, error);
  }
};

export const getAttributeCategoryById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid attribute category ID');
    return;
  }

  try {
    const category = await AttributeCategory.findById(id);
    if (!category) {
      sendResponse(res, 404, false, 'AttributeCategory not found.');
      return;
    }
    sendResponse(res, 200, true, 'Attribute category fetched successfully', category);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching attribute category.', null, error);
  }
};

export const createAttributeCategory = async (req: Request, res: Response): Promise<void> => {
  const { name, description, minScore, maxScore } = req.body;

  if (!name || !minScore || !maxScore) {
    sendResponse(res, 400, false, 'Missing required fields: name, minScore, or maxScore');
    return;
  }
  if (minScore >= maxScore) {
    sendResponse(res, 400, false, 'minScore must be less than maxScore');
    return;
  }

  try {
    const existingCategory = await AttributeCategory.findOne({ name });
    if (existingCategory) {
      sendResponse(res, 400, false, 'Attribute category name already exists.');
      return;
    }

    const category = await AttributeCategory.create({
      name,
      description: description || '',
      minScore,
      maxScore
    });

    sendResponse(res, 201, true, 'Attribute category created successfully.', category);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error creating attribute category.', null, error);
  }
};

export const updateAttributeCategory = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name, description, minScore, maxScore } = req.body;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid attribute category ID');
    return;
  }
  if (!name && !description && minScore === undefined && maxScore === undefined) {
    sendResponse(res, 400, false, 'At least one field (name, description, minScore, maxScore) required.');
    return;
  }
  if (minScore !== undefined && maxScore !== undefined && minScore >= maxScore) {
    sendResponse(res, 400, false, 'minScore must be less than maxScore');
    return;
  }

  try {
    const category = await AttributeCategory.findById(id);
    if (!category) {
      sendResponse(res, 404, false, 'AttributeCategory not found.');
      return;
    }

    if (name && name !== category.name) {
      const existingCategory = await AttributeCategory.findOne({ name });
      if (existingCategory) {
        sendResponse(res, 400, false, 'Attribute category name already exists.');
        return;
      }
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (minScore !== undefined) updateData.minScore = minScore;
    if (maxScore !== undefined) updateData.maxScore = maxScore;

    const updated = await AttributeCategory.findByIdAndUpdate(id, updateData, { new: true });
    sendResponse(res, 200, true, 'Attribute category updated successfully.', updated);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error updating attribute category.', null, error);
  }
};

export const deleteAttributeCategory = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid attribute category ID');
    return;
  }

  try {
    const category = await AttributeCategory.findById(id);
    if (!category) {
      sendResponse(res, 404, false, 'AttributeCategory not found.');
      return;
    }

    const observationCount = await Observation.countDocuments({ category: id });
    const flaggedIssueCount = await FlaggedIssue.countDocuments({ linkedAttribute: id });
    const dependencies = [];
    if (observationCount > 0) dependencies.push(`${observationCount} observation(s)`);
    if (flaggedIssueCount > 0) dependencies.push(`${flaggedIssueCount} flagged issue(s)`);
    if (dependencies.length > 0) {
      sendResponse(res, 400, false, `Cannot delete category; it is used by: ${dependencies.join(', ')}.`);
      return;
    }

    await AttributeCategory.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Attribute category deleted successfully.');
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting attribute category.', null, error);
  }
};