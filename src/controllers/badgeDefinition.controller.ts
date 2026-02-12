import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { BadgeDefinition } from '../models/badgeDefinition.model.js';
import { BadgeCriteria } from '../models/badgeCriteria.model.js';
import { StudentBadge } from '../models/studentBadge.model.js';
import { AttributeCategory } from '../models/attributeCategory.model.js';
import { ActionPlan } from '../models/actionPlan.model.js';
import UserAccount from '../models/userAccount.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';


import { uploadToCloudinary, deleteFromCloudinary } from '../utils/cloudinary.util.js';

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

  try {
    let icon: string | undefined;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        'icons/badges',
        undefined,
        'image'
      );
      icon = uploadResult.url;
    }

    const badge = await BadgeDefinition.create({
      name,
      description,
      level: Number(level),
      criteria,
      icon,
      createdBy,
    });

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

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, "Invalid badge definition ID");
    return;
  }

  let { name, description, level, criteria } = req.body;

  name = name?.trim();
  description = description?.trim();

  // At least one field must be provided for update
  if (!name && !description && level === undefined && criteria === undefined && !req.file) {
    sendResponse(res, 400, false, "At least one field (name, description, level, criteria, or icon) required");
    return;
  }

  try {
    const badge = await BadgeDefinition.findById(id);
    if (!badge) {
      sendResponse(res, 404, false, "BadgeDefinition not found");
      return;
    }

    // Prepare values for duplicate check
    let checkName = name || badge.name;
    let checkLevel = badge.level;

    // Handle level for duplicate check (only if level is being changed)
    if (level !== undefined && level !== "" && level !== null) {
      const parsedLevel = Number(level);
      if (isNaN(parsedLevel)) {
        sendResponse(res, 400, false, "Invalid level value - must be a number");
        return;
      }
      checkLevel = parsedLevel;
    }

    // Duplicate check only when name or level is changing
    if ((name && name !== badge.name) || checkLevel !== badge.level) {
      const existing = await BadgeDefinition.findOne({
        name: checkName,
        level: checkLevel,
        _id: { $ne: id },
      });

      if (existing) {
        sendResponse(res, 400, false, "Badge definition with this name and level already exists");
        return;
      }
    }

    // Validate criteria if provided in request
    if (criteria !== undefined && criteria.length > 0) {
      const validCriteria = await BadgeCriteria.find({ _id: { $in: criteria } });
      if (validCriteria.length !== criteria.length) {
        sendResponse(res, 400, false, "One or more criteria IDs are invalid");
        return;
      }
      for (const crit of validCriteria) {
        if (!crit.badgeDefinitionId.equals(id)) {
          sendResponse(res, 400, false, `Criteria ${crit._id} does not belong to this badge definition`);
          return;
        }
      }
    }

    // Build update object — only include fields that were actually sent
    const updateData: any = {};

    if (name !== undefined) {
      updateData.name = name;
    }
    if (description !== undefined) {
      updateData.description = description;
    }
    if (level !== undefined && level !== "" && level !== null) {
      const parsed = Number(level);
      if (!isNaN(parsed)) {
        updateData.level = parsed;
      } else {
        sendResponse(res, 400, false, "Invalid level value - must be a number");
        return;
      }
    }
    if (criteria !== undefined) {
      updateData.criteria = criteria;
    }

    // Handle icon upload / replacement
    if (req.file) {
      // Delete old icon if it exists
      if (badge.icon) {
        try {
          const urlParts = badge.icon.split("/");
          const filenameWithExt = urlParts[urlParts.length - 1];
          const publicId = urlParts.slice(-2, -1)[0] + "/" + filenameWithExt.split(".")[0];
          await deleteFromCloudinary(publicId);
        } catch (deleteErr) {
          console.warn("Failed to delete old Cloudinary icon:", deleteErr);
        }
      }

      // Upload new icon
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        "icons/badges",
        undefined,
        "image"
      );
      updateData.icon = uploadResult.url;
    }

    // Perform the update
    const updated = await BadgeDefinition.findByIdAndUpdate(id, updateData, { new: true })
      .populate("criteria", "type attributeCategoryId minScore actionPlanId minProgress minObservations scope")
      .populate("createdBy", "firstName lastName email role");

    sendResponse(res, 200, true, "Badge definition updated successfully", updated);
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error updating badge definition: ${(error as Error).message}`,
      null,
      error
    );
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

    if (badge.icon) {
      try {
        const urlParts = badge.icon.split('/');
        const filenameWithExt = urlParts[urlParts.length - 1];
        const publicId = urlParts.slice(-2, -1)[0] + '/' + filenameWithExt.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (deleteErr) {
        console.warn('Failed to delete Cloudinary icon on badge delete:', deleteErr);
      }
    }

    await BadgeDefinition.findByIdAndDelete(id);
    sendResponse(res, 200, true, 'Badge definition deleted successfully');
  } catch (error) {
    sendResponse(res, 500, false, `Server error deleting badge definition: ${(error as Error).message}`, null, error);
  }
};