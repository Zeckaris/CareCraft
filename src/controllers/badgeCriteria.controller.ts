import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { BadgeCriteria } from '../models/badgeCriteria.model.ts';
import { BadgeDefinition } from '../models/badgeDefinition.model.ts';
import { AttributeCategory } from '../models/attributeCategory.model.ts';
import { ActionPlan } from '../models/actionPlan.model.ts';
import { StudentBadge } from '../models/studentBadge.model.ts';
import { sendResponse } from '../utils/sendResponse.util.ts'

export const getAllBadgeCriteria = async (req: Request, res: Response): Promise<void> => {
  const { page = 1, limit = 10, badgeDefinitionId, type, attributeCategoryId } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const filter: any = {};
  if (badgeDefinitionId) {
    if (!mongoose.isValidObjectId(badgeDefinitionId)) {
      sendResponse(res, 400, false, 'Invalid badgeDefinitionId');
      return;
    }
    const badgeDefinition = await BadgeDefinition.findById(badgeDefinitionId);
    if (!badgeDefinition) {
      sendResponse(res, 404, false, 'BadgeDefinition not found');
      return;
    }
    filter.badgeDefinitionId = badgeDefinitionId;
  }
  if (type) {
    if (typeof type !== 'string' || !['scoreThreshold', 'actionPlanProgress', 'observationCount', 'custom', 'attributeEvaluationAverage'].includes(type)) {
      sendResponse(res, 400, false, 'Invalid type: must be scoreThreshold, actionPlanProgress, observationCount, custom, or attributeEvaluationAverage');
      return;
    }
    filter.type = type;
  }
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
    filter.attributeCategoryId = attributeCategoryId;
  }

  try {
    const criteria = await BadgeCriteria.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();
    const total = await BadgeCriteria.countDocuments(filter);

    sendResponse(res, 200, true, 'Badge criteria fetched successfully', criteria, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching badge criteria: ${(error as Error).message}`, null, error);
  }
};

export const getBadgeCriteriaById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge criteria ID');
    return;
  }

  try {
    const criteria = await BadgeCriteria.findById(id).lean();
    if (!criteria) {
      sendResponse(res, 404, false, 'BadgeCriteria not found');
      return;
    }
    sendResponse(res, 200, true, 'Badge criteria fetched successfully', criteria);
  } catch (error) {
    sendResponse(res, 500, false, `Server error fetching badge criteria: ${(error as Error).message}`, null, error);
  }
};


export const createBadgeCriteria = async (req: Request, res: Response): Promise<void> => {
  let { badgeDefinitionId, type, attributeCategoryId, minScore, actionPlanId, minProgress, minObservations, scope, description } = req.body;

  description = description?.trim();

  if (!badgeDefinitionId || !type) {
    sendResponse(res, 400, false, 'Missing required fields: badgeDefinitionId or type');
    return;
  }
  if (!mongoose.isValidObjectId(badgeDefinitionId)) {
    sendResponse(res, 400, false, 'Invalid badgeDefinitionId');
    return;
  }
  if (!['scoreThreshold', 'actionPlanProgress', 'observationCount', 'custom', 'attributeEvaluationAverage'].includes(type)) {
    sendResponse(res, 400, false, 'Invalid type: must be scoreThreshold, actionPlanProgress, observationCount, custom, or attributeEvaluationAverage');
    return;
  }
  if (attributeCategoryId && !mongoose.isValidObjectId(attributeCategoryId)) {
    sendResponse(res, 400, false, 'Invalid attributeCategoryId');
    return;
  }
  if (actionPlanId && !mongoose.isValidObjectId(actionPlanId)) {
    sendResponse(res, 400, false, 'Invalid actionPlanId');
    return;
  }
  if (minScore !== null && minScore !== undefined && (typeof minScore !== 'number' || minScore < (type === 'attributeEvaluationAverage' ? 1 : 0) || (type === 'attributeEvaluationAverage' && minScore > 5))) {
    sendResponse(res, 400, false, `minScore must be a ${type === 'attributeEvaluationAverage' ? 'number between 1 and 5' : 'non-negative number'}`);
    return;
  }
  if (minProgress !== null && minProgress !== undefined && (typeof minProgress !== 'number' || minProgress < 0 || minProgress > 100)) {
    sendResponse(res, 400, false, 'minProgress must be a number between 0 and 100');
    return;
  }
  if (minObservations !== null && minObservations !== undefined && (typeof minObservations !== 'number' || minObservations < 0)) {
    sendResponse(res, 400, false, 'minObservations must be a non-negative number');
    return;
  }

  try {
    // Validate referenced documents
    const badgeDefinition = await BadgeDefinition.findById(badgeDefinitionId);
    if (!badgeDefinition) {
      sendResponse(res, 404, false, 'BadgeDefinition not found');
      return;
    }
    if (attributeCategoryId && type !== 'attributeEvaluationAverage') {
      const attributeCategory = await AttributeCategory.findById(attributeCategoryId);
      if (!attributeCategory) {
        sendResponse(res, 404, false, 'AttributeCategory not found');
        return;
      }
      if (minScore !== null && minScore !== undefined && (minScore < attributeCategory.minScore || minScore > attributeCategory.maxScore)) {
        sendResponse(res, 400, false, `minScore must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}`);
        return;
      }
    }
    if (actionPlanId) {
      const actionPlan = await ActionPlan.findById(actionPlanId);
      if (!actionPlan) {
        sendResponse(res, 404, false, 'ActionPlan not found');
        return;
      }
    }

    // Validate type-specific fields
    if (type === 'scoreThreshold' && (!attributeCategoryId || minScore === null || minScore === undefined)) {
      sendResponse(res, 400, false, 'scoreThreshold requires attributeCategoryId and minScore');
      return;
    }
    if (type === 'actionPlanProgress' && (!actionPlanId || minProgress === null || minProgress === undefined)) {
      sendResponse(res, 400, false, 'actionPlanProgress requires actionPlanId and minProgress');
      return;
    }
    if (type === 'observationCount' && (!attributeCategoryId || minObservations === null || minObservations === undefined)) {
      sendResponse(res, 400, false, 'observationCount requires attributeCategoryId and minObservations');
      return;
    }
    if (type === 'custom' && !description) {
      sendResponse(res, 400, false, 'custom type requires a description');
      return;
    }
    if (type === 'attributeEvaluationAverage') {
      if (minScore === null || minScore === undefined || scope === undefined || !['yearly', 'allTime'].includes(scope)) {
        sendResponse(res, 400, false, 'attributeEvaluationAverage requires minScore and scope (yearly or allTime)');
        return;
      }
      if (attributeCategoryId || actionPlanId || minProgress !== null || minObservations !== null) {
        sendResponse(res, 400, false, 'attributeEvaluationAverage must have null attributeCategoryId, actionPlanId, minProgress, and minObservations');
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

    sendResponse(res, 201, true, 'Badge criteria created successfully', criteria);
  } catch (error) {
    sendResponse(res, 500, false, `Server error creating badge criteria: ${(error as Error).message}`, null, error);
  }
};

export const updateBadgeCriteria = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  let { badgeDefinitionId, type, attributeCategoryId, minScore, actionPlanId, minProgress, minObservations, scope, description } = req.body;

  description = description?.trim();

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge criteria ID');
    return;
  }
  if (!badgeDefinitionId && !type && !attributeCategoryId && minScore === undefined && !actionPlanId && minProgress === undefined && minObservations === undefined && scope === undefined && !description) {
    sendResponse(res, 400, false, 'At least one field (badgeDefinitionId, type, attributeCategoryId, minScore, actionPlanId, minProgress, minObservations, scope, description) required');
    return;
  }
  if (badgeDefinitionId && !mongoose.isValidObjectId(badgeDefinitionId)) {
    sendResponse(res, 400, false, 'Invalid badgeDefinitionId');
    return;
  }
  if (type && !['scoreThreshold', 'actionPlanProgress', 'observationCount', 'custom', 'attributeEvaluationAverage'].includes(type)) {
    sendResponse(res, 400, false, 'Invalid type: must be scoreThreshold, actionPlanProgress, observationCount, custom, or attributeEvaluationAverage');
    return;
  }
  if (attributeCategoryId && !mongoose.isValidObjectId(attributeCategoryId)) {
    sendResponse(res, 400, false, 'Invalid attributeCategoryId');
    return;
  }
  if (actionPlanId && !mongoose.isValidObjectId(actionPlanId)) {
    sendResponse(res, 400, false, 'Invalid actionPlanId');
    return;
  }
  if (minScore !== null && minScore !== undefined && (typeof minScore !== 'number' || minScore < (type === 'attributeEvaluationAverage' ? 1 : 0) || (type === 'attributeEvaluationAverage' && minScore > 5))) {
    sendResponse(res, 400, false, `minScore must be a ${type === 'attributeEvaluationAverage' ? 'number between 1 and 5' : 'non-negative number'}`);
    return;
  }
  if (minProgress !== null && minProgress !== undefined && (typeof minProgress !== 'number' || minProgress < 0 || minProgress > 100)) {
    sendResponse(res, 400, false, 'minProgress must be a number between 0 and 100');
    return;
  }
  if (minObservations !== null && minObservations !== undefined && (typeof minObservations !== 'number' || minObservations < 0)) {
    sendResponse(res, 400, false, 'minObservations must be a non-negative number');
    return;
  }

  try {
    const criteria = await BadgeCriteria.findById(id);
    if (!criteria) {
      sendResponse(res, 404, false, 'BadgeCriteria not found');
      return;
    }

    // Validate referenced documents
    if (badgeDefinitionId && badgeDefinitionId !== criteria.badgeDefinitionId.toString()) {
      const badgeDefinition = await BadgeDefinition.findById(badgeDefinitionId);
      if (!badgeDefinition) {
        sendResponse(res, 404, false, 'BadgeDefinition not found');
        return;
      }
    }
    if (attributeCategoryId && type !== 'attributeEvaluationAverage') {
      const attributeCategory = await AttributeCategory.findById(attributeCategoryId);
      if (!attributeCategory) {
        sendResponse(res, 404, false, 'AttributeCategory not found');
        return;
      }
      if (minScore !== null && minScore !== undefined && (minScore < attributeCategory.minScore || minScore > attributeCategory.maxScore)) {
        sendResponse(res, 400, false, `minScore must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}`);
        return;
      }
    }
    if (actionPlanId) {
      const actionPlan = await ActionPlan.findById(actionPlanId);
      if (!actionPlan) {
        sendResponse(res, 404, false, 'ActionPlan not found');
        return;
      }
    }

    // Validate type-specific fields
    if (type === 'scoreThreshold' && (!attributeCategoryId || minScore === null || minScore === undefined)) {
      sendResponse(res, 400, false, 'scoreThreshold requires attributeCategoryId and minScore');
      return;
    }
    if (type === 'actionPlanProgress' && (!actionPlanId || minProgress === null || minProgress === undefined)) {
      sendResponse(res, 400, false, 'actionPlanProgress requires actionPlanId and minProgress');
      return;
    }
    if (type === 'observationCount' && (!attributeCategoryId || minObservations === null || minObservations === undefined)) {
      sendResponse(res, 400, false, 'observationCount requires attributeCategoryId and minObservations');
      return;
    }
    if (type === 'custom' && !description) {
      sendResponse(res, 400, false, 'custom type requires a description');
      return;
    }
    if (type === 'attributeEvaluationAverage') {
      if (minScore === null || minScore === undefined || scope === undefined || !['yearly', 'allTime'].includes(scope)) {
        sendResponse(res, 400, false, 'attributeEvaluationAverage requires minScore and scope (yearly or allTime)');
        return;
      }
      if (attributeCategoryId || actionPlanId || minProgress !== null || minObservations !== null) {
        sendResponse(res, 400, false, 'attributeEvaluationAverage must have null attributeCategoryId, actionPlanId, minProgress, and minObservations');
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
    sendResponse(res, 200, true, 'Badge criteria updated successfully', updated);
  } catch (error) {
    sendResponse(res, 500, false, `Server error updating badge criteria: ${(error as Error).message}`, null, error);
  }
};

export const deleteBadgeCriteria = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge criteria ID');
    return;
  }

  try {
    const criteria = await BadgeCriteria.findById(id);
    if (!criteria) {
      sendResponse(res, 404, false, 'BadgeCriteria not found');
      return;
    }

    // Check for dependencies
    const studentBadgeCount = await StudentBadge.countDocuments({ badgeId: criteria.badgeDefinitionId });
    if (studentBadgeCount > 0) {
      sendResponse(res, 400, false, `Cannot delete badge criteria; linked to ${studentBadgeCount} student badge(s)`);
      return;
    }

    await BadgeDefinition.findByIdAndUpdate(criteria.badgeDefinitionId, { $pull: { criteria: id } });

    await BadgeCriteria.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Badge criteria deleted successfully');
  } catch (error) {
    sendResponse(res, 500, false, `Server error deleting badge criteria: ${(error as Error).message}`, null, error);
  }
};