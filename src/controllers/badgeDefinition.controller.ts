import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { BadgeDefinition } from '../models/badgeDefinition.model';
import { BadgeCriteria } from '../models/badgeCriteria.model';
import { StudentBadge } from '../models/studentBadge.model';
import { AttributeCategory } from '../models/attributeCategory.model';
import { ActionPlan } from '../models/actionPlan.model';
import  UserAccount  from '../models/userAccount.model';

export const getAllBadgeDefinitions = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, name, level, attributeCategoryId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (name) filter.name = { $regex: name as string, $options: 'i' };
  if (level) filter.level = Number(level);
  if (attributeCategoryId) {
    if (!mongoose.isValidObjectId(attributeCategoryId)) {
      res.status(400).json({ message: 'Invalid attributeCategoryId' });
      return;
    }
    const attributeCategory = await AttributeCategory.findById(attributeCategoryId);
    if (!attributeCategory) {
      res.status(404).json({ message: 'AttributeCategory not found' });
      return;
    }
    const criteria = await BadgeCriteria.find({ attributeCategoryId }).select('badgeDefinitionId').lean();
    filter._id = { $in: criteria.map(c => c.badgeDefinitionId) };
  }

  try {
    const badges = await BadgeDefinition.find(filter)
      .populate('criteria')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));
    const total = await BadgeDefinition.countDocuments(filter);

    res.status(200).json({
      data: badges,
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching badge definitions: ${(error as Error).message}` });
  }
};

export const getBadgeDefinitionById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid badge definition ID' });
    return;
  }

  try {
    const badge = await BadgeDefinition.findById(id).populate('criteria');
    if (!badge) {
      res.status(404).json({ message: 'BadgeDefinition not found' });
      return;
    }
    res.status(200).json({ data: badge });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching badge definition: ${(error as Error).message}` });
  }
};

export const createBadgeDefinition = async (req: Request, res: Response): Promise<void> => {
  let { name, description, icon, createdBy, level, criteria } = req.body;

  // Sanitize inputs
  name = name?.trim();
  description = description?.trim();
  icon = icon?.trim();

  // Validate required fields and formats
  if (!name || !description || !createdBy || !level) {
    res.status(400).json({ message: 'Missing required fields: name, description, createdBy, or level' });
    return;
  }
  if (!mongoose.isValidObjectId(createdBy)) {
    res.status(400).json({ message: 'Invalid createdBy ID' });
    return;
  }
  if (criteria && !criteria.every((id: string) => mongoose.isValidObjectId(id))) {
    res.status(400).json({ message: 'Invalid criteria ID(s)' });
    return;
  }
  if (name.length > 100) {
    res.status(400).json({ message: 'Name must be 100 characters or less' });
    return;
  }

  try {
    const user = await UserAccount.findById(createdBy);
    if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
      res.status(400).json({ message: 'Invalid createdBy: User does not exist or lacks required role (admin, coordinator, teacher)' });
      return;
    }

    // Check for duplicate badge
    const existingBadge = await BadgeDefinition.findOne({ name, level });
    if (existingBadge) {
      res.status(400).json({ message: 'Badge definition with this name and level already exists' });
      return;
    }

    if (criteria && criteria.length > 0) {
      const validCriteria = await BadgeCriteria.find({ _id: { $in: criteria } });
      if (validCriteria.length !== criteria.length) {
        res.status(400).json({ message: 'One or more criteria IDs are invalid' });
        return;
      }
      for (const crit of validCriteria) {
        if (crit.attributeCategoryId && !(await AttributeCategory.findById(crit.attributeCategoryId))) {
          res.status(400).json({ message: `Invalid attributeCategoryId in criteria: ${crit._id}` });
          return;
        }
        if (crit.actionPlanId && !(await ActionPlan.findById(crit.actionPlanId))) {
          res.status(400).json({ message: `Invalid actionPlanId in criteria: ${crit._id}` });
          return;
        }
      }
    }

    const badge = await BadgeDefinition.create({
      name,
      description,
      icon: icon || '',
      createdBy,
      level,
      criteria: criteria || []
    });


    if (criteria && criteria.length > 0) {
      await BadgeCriteria.updateMany(
        { _id: { $in: criteria } },
        { $set: { badgeDefinitionId: badge._id } }
      );
    }

    res.status(201).json({ message: 'Badge definition created successfully', data: badge });
  } catch (error) {
    res.status(500).json({ message: `Server error creating badge definition: ${(error as Error).message}` });
  }
};

export const updateBadgeDefinition = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  let { name, description, icon, createdBy, level, criteria } = req.body;

  // Sanitize inputs
  name = name?.trim();
  description = description?.trim();
  icon = icon?.trim();

  // Validate inputs
  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid badge definition ID' });
    return;
  }
  if (!name && !description && icon === undefined && level === undefined && !criteria && !createdBy) {
    res.status(400).json({ message: 'At least one field (name, description, icon, level, criteria, createdBy) required' });
    return;
  }
  if (createdBy && !mongoose.isValidObjectId(createdBy)) {
    res.status(400).json({ message: 'Invalid createdBy ID' });
    return;
  }
  if (criteria && !criteria.every((id: string) => mongoose.isValidObjectId(id))) {
    res.status(400).json({ message: 'Invalid criteria ID(s)' });
    return;
  }
  if (name && name.length > 100) {
    res.status(400).json({ message: 'Name must be 100 characters or less' });
    return;
  }

  try {
    const badge = await BadgeDefinition.findById(id);
    if (!badge) {
      res.status(404).json({ message: 'BadgeDefinition not found' });
      return;
    }

    // Validate createdBy if provided
    if (createdBy) {
      const user = await UserAccount.findById(createdBy);
      if (!user || !['admin', 'coordinator', 'teacher'].includes(user.role)) {
        res.status(400).json({ message: 'Invalid createdBy: User does not exist or lacks required role (admin, coordinator, teacher)' });
        return;
      }
    }

    // Check for duplicate badge
    if (name && level && (name !== badge.name || level !== badge.level)) {
      const existingBadge = await BadgeDefinition.findOne({ name, level });
      if (existingBadge) {
        res.status(400).json({ message: 'Badge definition with this name and level already exists' });
        return;
      }
    }

    // Validate criteria (if provided)
    if (criteria && criteria.length > 0) {
      const validCriteria = await BadgeCriteria.find({ _id: { $in: criteria } });
      if (validCriteria.length !== criteria.length) {
        res.status(400).json({ message: 'One or more criteria IDs are invalid' });
        return;
      }
      for (const crit of validCriteria) {
        if (crit.attributeCategoryId && !(await AttributeCategory.findById(crit.attributeCategoryId))) {
          res.status(400).json({ message: `Invalid attributeCategoryId in criteria: ${crit._id}` });
          return;
        }
        if (crit.actionPlanId && !(await ActionPlan.findById(crit.actionPlanId))) {
          res.status(400).json({ message: `Invalid actionPlanId in criteria: ${crit._id}` });
          return;
        }
        if (!crit.badgeDefinitionId.equals(id)) {
          res.status(400).json({ message: `Criteria ${crit._id} does not belong to this badge definition` });
          return;
        }
      }
    }

    const updateData: any = {};
    if (name) updateData.name = name;
    if (description) updateData.description = description;
    if (icon !== undefined) updateData.icon = icon;
    if (level !== undefined) updateData.level = level;
    if (criteria) updateData.criteria = criteria;
    if (createdBy) updateData.createdBy = createdBy;

    const updated = await BadgeDefinition.findByIdAndUpdate(id, updateData, { new: true }).populate('criteria');
    res.status(200).json({ message: 'Badge definition updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ message: `Server error updating badge definition: ${(error as Error).message}` });
  }
};

export const deleteBadgeDefinition = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid badge definition ID' });
    return;
  }

  try {
    const badge = await BadgeDefinition.findById(id);
    if (!badge) {
      res.status(404).json({ message: 'BadgeDefinition not found' });
      return;
    }

    const studentBadgeCount = await StudentBadge.countDocuments({ badgeId: id });
    const criteriaCount = await BadgeCriteria.countDocuments({ badgeDefinitionId: id });
    const dependencies = [];
    if (studentBadgeCount > 0) dependencies.push(`${studentBadgeCount} student badge(s)`);
    if (criteriaCount > 0) dependencies.push(`${criteriaCount} badge criteria`);
    if (dependencies.length > 0) {
      res.status(400).json({ message: `Cannot delete badge definition; it is used by: ${dependencies.join(', ')}` });
      return;
    }

    await BadgeDefinition.findByIdAndDelete(id);
    res.status(200).json({ message: 'Badge definition deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: `Server error deleting badge definition: ${(error as Error).message}` });
  }
};