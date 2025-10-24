import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { BadgeCriteria } from '../models/badgeCriteria.model';
import { BadgeDefinition } from '../models/badgeDefinition.model';
import { AttributeCategory } from '../models/attributeCategory.model';
import { ActionPlan } from '../models/actionPlan.model';
import { StudentBadge } from '../models/studentBadge.model';

export const getAllBadgeCriteria = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, badgeDefinitionId, type, attributeCategoryId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (badgeDefinitionId) {
    if (!mongoose.isValidObjectId(badgeDefinitionId)) {
      res.status(400).json({ message: 'Invalid badgeDefinitionId' });
      return;
    }
    const badgeDefinition = await BadgeDefinition.findById(badgeDefinitionId);
    if (!badgeDefinition) {
      res.status(404).json({ message: 'BadgeDefinition not found' });
      return;
    }
    filter.badgeDefinitionId = badgeDefinitionId;
  }
  if (type) {
    if (typeof type !== 'string' || !['scoreThreshold', 'actionPlanProgress', 'observationCount', 'custom', 'attributeEvaluationAverage'].includes(type)) {
      res.status(400).json({ message: 'Invalid type: must be scoreThreshold, actionPlanProgress, observationCount, custom, or attributeEvaluationAverage' });
      return;
    }
    filter.type = type;
  }
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
    filter.attributeCategoryId = attributeCategoryId;
  }

  try {
    const criteria = await BadgeCriteria.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await BadgeCriteria.countDocuments(filter);

    res.status(200).json({
      data: criteria,
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching badge criteria: ${(error as Error).message}` });
  }
};

export const getBadgeCriteriaById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid badge criteria ID' });
    return;
  }

  try {
    const criteria = await BadgeCriteria.findById(id).lean();
    if (!criteria) {
      res.status(404).json({ message: 'BadgeCriteria not found' });
      return;
    }
    res.status(200).json({ data: criteria });
  } catch (error) {
    res.status(500).json({ message: `Server error fetching badge criteria: ${(error as Error).message}` });
  }
};

export const createBadgeCriteria = async (req: Request, res: Response): Promise<void> => {
  let { badgeDefinitionId, type, attributeCategoryId, minScore, actionPlanId, minProgress, minObservations, scope, description } = req.body;

  description = description?.trim();

  if (!badgeDefinitionId || !type) {
    res.status(400).json({ message: 'Missing required fields: badgeDefinitionId or type' });
    return;
  }
  if (!mongoose.isValidObjectId(badgeDefinitionId)) {
    res.status(400).json({ message: 'Invalid badgeDefinitionId' });
    return;
  }
  if (!['scoreThreshold', 'actionPlanProgress', 'observationCount', 'custom', 'attributeEvaluationAverage'].includes(type)) {
    res.status(400).json({ message: 'Invalid type: must be scoreThreshold, actionPlanProgress, observationCount, custom, or attributeEvaluationAverage' });
    return;
  }
  if (attributeCategoryId && !mongoose.isValidObjectId(attributeCategoryId)) {
    res.status(400).json({ message: 'Invalid attributeCategoryId' });
    return;
  }
  if (actionPlanId && !mongoose.isValidObjectId(actionPlanId)) {
    res.status(400).json({ message: 'Invalid actionPlanId' });
    return;
  }
  if (minScore !== null && minScore !== undefined && (typeof minScore !== 'number' || minScore < (type === 'attributeEvaluationAverage' ? 1 : 0) || (type === 'attributeEvaluationAverage' && minScore > 5))) {
    res.status(400).json({ message: `minScore must be a ${type === 'attributeEvaluationAverage' ? 'number between 1 and 5' : 'non-negative number'}` });
    return;
  }
  if (minProgress !== null && minProgress !== undefined && (typeof minProgress !== 'number' || minProgress < 0 || minProgress > 100)) {
    res.status(400).json({ message: 'minProgress must be a number between 0 and 100' });
    return;
  }
  if (minObservations !== null && minObservations !== undefined && (typeof minObservations !== 'number' || minObservations < 0)) {
    res.status(400).json({ message: 'minObservations must be a non-negative number' });
    return;
  }

  try {
    // Validate referenced documents
    const badgeDefinition = await BadgeDefinition.findById(badgeDefinitionId);
    if (!badgeDefinition) {
      res.status(404).json({ message: 'BadgeDefinition not found' });
      return;
    }
    if (attributeCategoryId && type !== 'attributeEvaluationAverage') {
      const attributeCategory = await AttributeCategory.findById(attributeCategoryId);
      if (!attributeCategory) {
        res.status(404).json({ message: 'AttributeCategory not found' });
        return;
      }
      if (minScore !== null && minScore !== undefined && (minScore < attributeCategory.minScore || minScore > attributeCategory.maxScore)) {
        res.status(400).json({ message: `minScore must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}` });
        return;
      }
    }
    if (actionPlanId) {
      const actionPlan = await ActionPlan.findById(actionPlanId);
      if (!actionPlan) {
        res.status(404).json({ message: 'ActionPlan not found' });
        return;
      }
    }

    // Validate type-specific fields
    if (type === 'scoreThreshold' && (!attributeCategoryId || minScore === null || minScore === undefined)) {
      res.status(400).json({ message: 'scoreThreshold requires attributeCategoryId and minScore' });
      return;
    }
    if (type === 'actionPlanProgress' && (!actionPlanId || minProgress === null || minProgress === undefined)) {
      res.status(400).json({ message: 'actionPlanProgress requires actionPlanId and minProgress' });
      return;
    }
    if (type === 'observationCount' && (!attributeCategoryId || minObservations === null || minObservations === undefined)) {
      res.status(400).json({ message: 'observationCount requires attributeCategoryId and minObservations' });
      return;
    }
    if (type === 'custom' && !description) {
      res.status(400).json({ message: 'custom type requires a description' });
      return;
    }
    if (type === 'attributeEvaluationAverage') {
      if (minScore === null || minScore === undefined || scope === undefined || !['yearly', 'allTime'].includes(scope)) {
        res.status(400).json({ message: 'attributeEvaluationAverage requires minScore and scope (yearly or allTime)' });
        return;
      }
      if (attributeCategoryId || actionPlanId || minProgress !== null || minObservations !== null) {
        res.status(400).json({ message: 'attributeEvaluationAverage must have null attributeCategoryId, actionPlanId, minProgress, and minObservations' });
        return;
      }
    }

    const criteria = await BadgeCriteria.create({
      badgeDefinitionId,
      type,
      attributeCategoryId: attributeCategoryId || null,
      minScore: minScore !== undefined ? minScore : null,
      actionPlanId: actionPlanId || null,
      minProgress: minProgress !== undefined ? minProgress : null,
      minObservations: minObservations !== undefined ? minObservations : null,
      scope: scope || null,
      description: description || ''
    });

    // Automatically add criteria ID to BadgeDefinition.criteria
    await BadgeDefinition.findByIdAndUpdate(
      badgeDefinitionId,
      { $addToSet: { criteria: criteria._id } },
      { new: true }
    );

    res.status(201).json({ message: 'Badge criteria created successfully', data: criteria });
  } catch (error) {
    res.status(500).json({ message: `Server error creating badge criteria: ${(error as Error).message}` });
  }
};

export const updateBadgeCriteria = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  let { badgeDefinitionId, type, attributeCategoryId, minScore, actionPlanId, minProgress, minObservations, scope, description } = req.body;

  description = description?.trim();

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid badge criteria ID' });
    return;
  }
  if (!badgeDefinitionId && !type && !attributeCategoryId && minScore === undefined && !actionPlanId && minProgress === undefined && minObservations === undefined && scope === undefined && !description) {
    res.status(400).json({ message: 'At least one field (badgeDefinitionId, type, attributeCategoryId, minScore, actionPlanId, minProgress, minObservations, scope, description) required' });
    return;
  }
  if (badgeDefinitionId && !mongoose.isValidObjectId(badgeDefinitionId)) {
    res.status(400).json({ message: 'Invalid badgeDefinitionId' });
    return;
  }
  if (type && !['scoreThreshold', 'actionPlanProgress', 'observationCount', 'custom', 'attributeEvaluationAverage'].includes(type)) {
    res.status(400).json({ message: 'Invalid type: must be scoreThreshold, actionPlanProgress, observationCount, custom, or attributeEvaluationAverage' });
    return;
  }
  if (attributeCategoryId && !mongoose.isValidObjectId(attributeCategoryId)) {
    res.status(400).json({ message: 'Invalid attributeCategoryId' });
    return;
  }
  if (actionPlanId && !mongoose.isValidObjectId(actionPlanId)) {
    res.status(400).json({ message: 'Invalid actionPlanId' });
    return;
  }
  if (minScore !== null && minScore !== undefined && (typeof minScore !== 'number' || minScore < (type === 'attributeEvaluationAverage' ? 1 : 0) || (type === 'attributeEvaluationAverage' && minScore > 5))) {
    res.status(400).json({ message: `minScore must be a ${type === 'attributeEvaluationAverage' ? 'number between 1 and 5' : 'non-negative number'}` });
    return;
  }
  if (minProgress !== null && minProgress !== undefined && (typeof minProgress !== 'number' || minProgress < 0 || minProgress > 100)) {
    res.status(400).json({ message: 'minProgress must be a number between 0 and 100' });
    return;
  }
  if (minObservations !== null && minObservations !== undefined && (typeof minObservations !== 'number' || minObservations < 0)) {
    res.status(400).json({ message: 'minObservations must be a non-negative number' });
    return;
  }

  try {
    const criteria = await BadgeCriteria.findById(id);
    if (!criteria) {
      res.status(404).json({ message: 'BadgeCriteria not found' });
      return;
    }

    // Validate referenced documents
    if (badgeDefinitionId && badgeDefinitionId !== criteria.badgeDefinitionId.toString()) {
      const badgeDefinition = await BadgeDefinition.findById(badgeDefinitionId);
      if (!badgeDefinition) {
        res.status(404).json({ message: 'BadgeDefinition not found' });
        return;
      }
    }
    if (attributeCategoryId && type !== 'attributeEvaluationAverage') {
      const attributeCategory = await AttributeCategory.findById(attributeCategoryId);
      if (!attributeCategory) {
        res.status(404).json({ message: 'AttributeCategory not found' });
        return;
      }
      if (minScore !== null && minScore !== undefined && (minScore < attributeCategory.minScore || minScore > attributeCategory.maxScore)) {
        res.status(400).json({ message: `minScore must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}` });
        return;
      }
    }
    if (actionPlanId) {
      const actionPlan = await ActionPlan.findById(actionPlanId);
      if (!actionPlan) {
        res.status(404).json({ message: 'ActionPlan not found' });
        return;
      }
    }

    // Validate type-specific fields
    if (type === 'scoreThreshold' && (!attributeCategoryId || minScore === null || minScore === undefined)) {
      res.status(400).json({ message: 'scoreThreshold requires attributeCategoryId and minScore' });
      return;
    }
    if (type === 'actionPlanProgress' && (!actionPlanId || minProgress === null || minProgress === undefined)) {
      res.status(400).json({ message: 'actionPlanProgress requires actionPlanId and minProgress' });
      return;
    }
    if (type === 'observationCount' && (!attributeCategoryId || minObservations === null || minObservations === undefined)) {
      res.status(400).json({ message: 'observationCount requires attributeCategoryId and minObservations' });
      return;
    }
    if (type === 'custom' && !description) {
      res.status(400).json({ message: 'custom type requires a description' });
      return;
    }
    if (type === 'attributeEvaluationAverage') {
      if (minScore === null || minScore === undefined || scope === undefined || !['yearly', 'allTime'].includes(scope)) {
        res.status(400).json({ message: 'attributeEvaluationAverage requires minScore and scope (yearly or allTime)' });
        return;
      }
      if (attributeCategoryId || actionPlanId || minProgress !== null || minObservations !== null) {
        res.status(400).json({ message: 'attributeEvaluationAverage must have null attributeCategoryId, actionPlanId, minProgress, and minObservations' });
        return;
      }
    }

    // Update badgeDefinitionId in BadgeDefinition.criteria if changed
    if (badgeDefinitionId && badgeDefinitionId !== criteria.badgeDefinitionId.toString()) {
      await BadgeDefinition.findByIdAndUpdate(criteria.badgeDefinitionId, { $pull: { criteria: id } });
      await BadgeDefinition.findByIdAndUpdate(badgeDefinitionId, { $addToSet: { criteria: id } });
    }

    const updateData: any = {};
    if (badgeDefinitionId) updateData.badgeDefinitionId = badgeDefinitionId;
    if (type) updateData.type = type;
    if (attributeCategoryId !== undefined) updateData.attributeCategoryId = attributeCategoryId || null;
    if (minScore !== undefined) updateData.minScore = minScore !== null ? minScore : null;
    if (actionPlanId !== undefined) updateData.actionPlanId = actionPlanId || null;
    if (minProgress !== undefined) updateData.minProgress = minProgress !== null ? minProgress : null;
    if (minObservations !== undefined) updateData.minObservations = minObservations !== null ? minObservations : null;
    if (scope !== undefined) updateData.scope = scope || null;
    if (description !== undefined) updateData.description = description || '';

    const updated = await BadgeCriteria.findByIdAndUpdate(id, updateData, { new: true }).lean();
    res.status(200).json({ message: 'Badge criteria updated successfully', data: updated });
  } catch (error) {
    res.status(500).json({ message: `Server error updating badge criteria: ${(error as Error).message}` });
  }
};

export const deleteBadgeCriteria = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    res.status(400).json({ message: 'Invalid badge criteria ID' });
    return;
  }

  try {
    const criteria = await BadgeCriteria.findById(id);
    if (!criteria) {
      res.status(404).json({ message: 'BadgeCriteria not found' });
      return;
    }

    // Check for dependencies
    const studentBadgeCount = await StudentBadge.countDocuments({ badgeId: criteria.badgeDefinitionId });
    if (studentBadgeCount > 0) {
      res.status(400).json({ message: `Cannot delete badge criteria; linked to ${studentBadgeCount} student badge(s)` });
      return;
    }

    await BadgeDefinition.findByIdAndUpdate(criteria.badgeDefinitionId, { $pull: { criteria: id } });

    await BadgeCriteria.findByIdAndDelete(id);
    res.status(200).json({ message: 'Badge criteria deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: `Server error deleting badge criteria: ${(error as Error).message}` });
  }
};