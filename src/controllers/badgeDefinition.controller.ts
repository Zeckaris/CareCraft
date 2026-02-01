import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { BadgeDefinition } from '../models/badgeDefinition.model.js';
import { BadgeCriteria } from '../models/badgeCriteria.model.js';
import { StudentBadge } from '../models/studentBadge.model.js';
import { AttributeCategory } from '../models/attributeCategory.model.js';
import { ActionPlan } from '../models/actionPlan.model.js';
import  UserAccount  from '../models/userAccount.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import path from 'path';
import fs from 'fs';

interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'admin' | 'teacher' | 'parent' | 'student' | 'coordinator';
  };
  file?: Express.Multer.File;
}

export const getAllBadgeDefinitions = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, name, level, attributeCategoryId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (name) filter.name = { $regex: name as string, $options: 'i' };
  if (level) filter.level = Number(level);
  if (attributeCategoryId) {
    if (!mongoose.isValidObjectId(attributeCategoryId)) {
      sendResponse(res, 400, false, 'Invalid attributeCategoryId');
      return;
    }
    const attributeCategory = await AttributeCategory.findById(attributeCategoryId);
    if (!attributeCategory) {
      sendResponse(res, 404, false, 'AttributeCategory not found');
      return;
    }
    const criteria = await BadgeCriteria.find({ attributeCategoryId }).select('badgeDefinitionId').lean();
    filter._id = { $in: criteria.map(c => c.badgeDefinitionId) };
  }

  try {
    const badges = await BadgeDefinition.find(filter)
      .populate('criteria', 'type attributeCategoryId minScore actionPlanId minProgress minObservations scope')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await BadgeDefinition.countDocuments(filter);

    sendResponse(res, 200, true, 'Badge definitions fetched successfully', badges, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching badge definitions: ${(error as Error).message}`, null, error);
  }
};

export const getBadgeDefinitionById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge definition ID');
    return;
  }

  try {
    const badge = await BadgeDefinition.findById(id)
      .populate('criteria', 'type attributeCategoryId minScore actionPlanId minProgress minObservations scope');
    if (!badge) {
      sendResponse(res, 404, false, 'BadgeDefinition not found');
      return;
    }
    sendResponse(res, 200, true, 'Badge definition fetched successfully', badge);
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching badge definition: ${(error as Error).message}`, null, error);
  }
};

export const createBadgeDefinition = async (req: AuthRequest, res: Response): Promise<void> => {
  let { name, description, level, criteria = [] } = req.body;

  // Sanitize
  name = name?.trim();
  description = description?.trim();

  if (!name || !description || level === undefined) {
    sendResponse(res, 400, false, 'Missing required fields: name, description, or level');
    return;
  }

  const createdBy = req.user?.id;
  if (!createdBy || !mongoose.isValidObjectId(createdBy)) {
    sendResponse(res, 401, false, 'Authentication error: invalid or missing user');
    return;
  }

  if (criteria.length > 0 && !criteria.every((id: string) => mongoose.isValidObjectId(id))) {
    sendResponse(res, 400, false, 'Invalid criteria ID(s)');
    return;
  }

  if (name.length > 100) {
    sendResponse(res, 400, false, 'Name must be 100 characters or less');
    return;
  }

  try {
    const user = await UserAccount.findById(createdBy);
    if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
      sendResponse(res, 403, false, 'Access denied: user lacks required role');
      return;
    }

    const existingBadge = await BadgeDefinition.findOne({ name, level });
    if (existingBadge) {
      sendResponse(res, 400, false, 'Badge definition with this name and level already exists');
      return;
    }

    if (criteria.length > 0) {
      const validCriteria = await BadgeCriteria.find({ _id: { $in: criteria } });
      if (validCriteria.length !== criteria.length) {
        sendResponse(res, 400, false, 'One or more criteria IDs are invalid');
        return;
      }
      for (const crit of validCriteria) {
        if (crit.attributeCategoryId && !(await AttributeCategory.findById(crit.attributeCategoryId))) {
          sendResponse(res, 400, false, `Invalid attributeCategoryId in criteria: ${crit._id}`);
          return;
        }
        if (crit.actionPlanId && !(await ActionPlan.findById(crit.actionPlanId))) {
          sendResponse(res, 400, false, `Invalid actionPlanId in criteria: ${crit._id}`);
          return;
        }
      }
    }

    // Handle icon upload
    let iconPath = '';
    if (req.file) {
      iconPath = `/uploads/icons/badges/${req.file.filename}`;
    }

    const badge = await BadgeDefinition.create({
      name,
      description,
      icon: iconPath,
      createdBy,
      level,
      criteria,
    });

    if (criteria.length > 0) {
      await BadgeCriteria.updateMany(
        { _id: { $in: criteria } },
        { $set: { badgeDefinitionId: badge._id } }
      );
    }

    const populated = await BadgeDefinition.findById(badge._id)
      .populate('criteria', 'type attributeCategoryId minScore actionPlanId minProgress minObservations scope')
      .populate('createdBy', 'firstName lastName email role');

    sendResponse(res, 201, true, 'Badge definition created successfully', populated);
  } catch (error) {
    sendResponse(res, 500, false, `Server error creating badge definition: ${(error as Error).message}`, null, error);
  }
};

export const updateBadgeDefinition = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  let { name, description, level, criteria } = req.body;

  name = name?.trim();
  description = description?.trim();

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge definition ID');
    return;
  }

  if (!name && !description && level === undefined && criteria === undefined && !req.file) {
    sendResponse(res, 400, false, 'At least one field (name, description, level, criteria, or icon) required');
    return;
  }

  try {
    const badge = await BadgeDefinition.findById(id);
    if (!badge) {
      sendResponse(res, 404, false, 'BadgeDefinition not found');
      return;
    }

    // Duplicate check if name or level changing
    if ((name && name !== badge.name) || (level !== undefined && level !== badge.level)) {
      const existing = await BadgeDefinition.findOne({
        name: name || badge.name,
        level: level !== undefined ? level : badge.level,
        _id: { $ne: id }
      });
      if (existing) {
        sendResponse(res, 400, false, 'Badge definition with this name and level already exists');
        return;
      }
    }

    // Validate criteria if provided
    if (criteria && criteria.length > 0) {
      const validCriteria = await BadgeCriteria.find({ _id: { $in: criteria } });
      if (validCriteria.length !== criteria.length) {
        sendResponse(res, 400, false, 'One or more criteria IDs are invalid');
        return;
      }
      for (const crit of validCriteria) {
        if (!crit.badgeDefinitionId.equals(id)) {
          sendResponse(res, 400, false, `Criteria ${crit._id} does not belong to this badge definition`);
          return;
        }
      }
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (description) updateData.description = description;
    if (level !== undefined) updateData.level = level;
    if (criteria) updateData.criteria = criteria;

    // Handle icon upload and old file deletion
    if (req.file) {
      // Delete old icon if exists
      if (badge.icon) {
        const oldPath = path.join(import.meta.dirname, '..', '..', badge.icon);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      updateData.icon = `/uploads/icons/badges/${req.file.filename}`;
    }

    const updated = await BadgeDefinition.findByIdAndUpdate(id, updateData, { new: true })
      .populate('criteria', 'type attributeCategoryId minScore actionPlanId minProgress minObservations scope')
      .populate('createdBy', 'firstName lastName email role');

    sendResponse(res, 200, true, 'Badge definition updated successfully', updated);
  } catch (error) {
    sendResponse(res, 500, false, `Server error updating badge definition: ${(error as Error).message}`, null, error);
  }
};

export const deleteBadgeDefinition = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge definition ID');
    return;
  }

  try {
    const badge = await BadgeDefinition.findById(id);
    if (!badge) {
      sendResponse(res, 404, false, 'BadgeDefinition not found');
      return;
    }

    const studentBadgeCount = await StudentBadge.countDocuments({ badgeId: id });
    const criteriaCount = await BadgeCriteria.countDocuments({ badgeDefinitionId: id });
    const dependencies = [];
    if (studentBadgeCount > 0) dependencies.push(`${studentBadgeCount} student badge(s)`);
    if (criteriaCount > 0) dependencies.push(`${criteriaCount} badge criteria`);
    if (dependencies.length > 0) {
      sendResponse(res, 400, false, `Cannot delete badge definition; it is used by: ${dependencies.join(', ')}`);
      return;
    }

    await BadgeDefinition.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Badge definition deleted successfully');
  } catch (error) {
    sendResponse(res, 500, false, `Server error deleting badge definition: ${(error as Error).message}`, null, error);
  }
};