import { Request, Response } from 'express';
import { Types } from 'mongoose';
import {SharedPlanTemplate} from '../models/sharedPlanTemplate.model.ts';
import {ActionPlan} from '../models/actionPlan.model.ts';
import {AttributeCategory} from '../models/attributeCategory.model.ts';
import {Student} from '../models/student.model.ts';
import UserAccount from '../models/userAccount.model.ts';
import { sendResponse } from  '../utils/sendResponse.util.ts';

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string };
}

export const createTemplateFromActionPlan = async (req: AuthRequest, res: Response) => {
  try {
    const { actionPlanId } = req.params;
    const { title, categoryId } = req.body;
    const user = req.user;

    console.log('Request body:', req.body);
    console.log('User:', user);

    if (!user || !user.id) {
      return sendResponse(res, 401, false, 'User not authenticated');
    }

    if (!title || !categoryId) {
      return sendResponse(res, 400, false, 'Title and categoryId are required');
    }

    if (!Types.ObjectId.isValid(categoryId)) {
      return sendResponse(res, 400, false, 'Invalid categoryId format');
    }

    const actionPlan = await ActionPlan.findById(actionPlanId);
    if (!actionPlan) {
      return sendResponse(res, 404, false, 'ActionPlan not found');
    }

    const category = await AttributeCategory.findById(categoryId);
    if (!category) {
      return sendResponse(res, 400, false, 'Invalid categoryId: Category not found');
    }

    const actionSteps = actionPlan.actionSteps.map((step, index) => ({
      stepNumber: index + 1,
      description: step.step,
    }));

    const template = new SharedPlanTemplate({
      title,
      categoryId,
      actionSteps,
      createdBy: user.id,
      usageCount: 0,
      rating: 0,
      ratingCount: 0,
      ratedBy: [],
    });

    await template.save();
    console.log('Template saved:', template._id);

    const populatedTemplate = await SharedPlanTemplate.findById(template._id)
      .populate('categoryId', 'name')
      .populate('createdBy', 'firstName lastName email');

    if (!populatedTemplate) {
      return sendResponse(res, 500, false, 'Failed to populate template');
    }

    sendResponse(res, 201, true, 'Template created successfully', populatedTemplate);
  } catch (error) {
    console.error('Create template error:', error);
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`, null, error);
  }
};

export const getAllTemplates = async (req: Request, res: Response) => {
  try {
    const { categoryId, search, sort, limit = 10, page = 1 } = req.query;

    const query: any = {};
    if (categoryId) {
      query.categoryId = categoryId;
    }
    if (search) {
      query.title = { $regex: search, $options: 'i' };
    }

    const sortOptions: any = {};
    if (sort) {
      const [field, order] = (sort as string).split(',');
      sortOptions[field] = order === 'desc' ? -1 : 1;
    } else {
      sortOptions.createdAt = -1;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [templates, total] = await Promise.all([
      SharedPlanTemplate.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(Number(limit))
        .populate('categoryId', 'name')
        .populate('createdBy', 'firstName lastName email'),
      SharedPlanTemplate.countDocuments(query),
    ]);

    sendResponse(res, 200, true, 'Templates fetched successfully', templates, null, {
      total,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching templates', null, error);
  }
};

export const getTemplateById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const template = await SharedPlanTemplate.findById(id)
      .populate('categoryId', 'name')
      .populate('createdBy', 'firstName lastName email');

    if (!template) {
      return sendResponse(res, 404, false, 'Template not found');
    }

    sendResponse(res, 200, true, 'Template fetched successfully', template);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching template', null, error);
  }
};

export const applyTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { studentId, teacherId, issue, goal, startDate, endDate } = req.body;

    console.log('Apply template - Request body:', req.body);
    console.log('Apply template - User:', req.user);

    if (!studentId || !teacherId || !issue || !goal || !startDate || !endDate) {
      return sendResponse(res, 400, false, 'All fields (studentId, teacherId, issue, goal, startDate, endDate) are required');
    }

    const template = await SharedPlanTemplate.findById(id);
    if (!template) {
      return sendResponse(res, 404, false, 'Template not found');
    }

    // Check if student and teacher exist
    const [student, teacher] = await Promise.all([
      Student.findById(studentId),
      UserAccount.findById(teacherId),
    ]);
    if (!student) {
      return sendResponse(res, 400, false, 'Invalid studentId');
    }
    if (!teacher || !['teacher', 'admin'].includes(teacher.role)) {
      return sendResponse(res, 400, false, 'Invalid teacherId: User must have teacher or admin role');
    }

    const actionSteps = template.actionSteps.map(step => ({
      step: step.description,
      completed: false,
    }));

    const actionPlan = new ActionPlan({
      studentId,
      teacherId,
      issue,
      goal,
      actionSteps,
      startDate,
      endDate,
    });

    await actionPlan.save();
    console.log('ActionPlan saved:', actionPlan._id);

    template.usageCount += 1;
    await template.save();

    const populatedActionPlan = await ActionPlan.findById(actionPlan._id)
      .populate('studentId', 'firstName lastName')
      .populate('teacherId', 'firstName lastName email');

    sendResponse(res, 201, true, 'Template applied successfully', populatedActionPlan);
  } catch (error) {
    console.error('Apply template error:', error);
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`, null, error);
  }
};

export const rateTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { rating } = req.body;
    const user = req.user;

    console.log('Rate template - Request body:', req.body);
    console.log('Rate template - User:', req.user);

    if (!user || !user.id) {
      return sendResponse(res, 401, false, 'User not authenticated');
    }

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return sendResponse(res, 400, false, 'Rating must be between 1 and 5');
    }

    const template = await SharedPlanTemplate.findById(id);
    if (!template) {
      return sendResponse(res, 404, false, 'Template not found');
    }

    const userId = new Types.ObjectId(user.id);
    if (template.ratedBy.some((id) => id.equals(userId))) {
      return sendResponse(res, 400, false, 'You have already rated this template');
    }

    template.rating = (template.rating * template.ratingCount + rating) / (template.ratingCount + 1);
    template.ratingCount += 1;
    template.ratedBy.push(userId);

    await template.save();
    console.log('Template rated:', template._id, 'RatedBy:', template.ratedBy);

    const populatedTemplate = await SharedPlanTemplate.findById(id)
      .populate('categoryId', 'name')
      .populate('createdBy', 'firstName lastName email');

    sendResponse(res, 200, true, 'Template rated successfully', populatedTemplate);
  } catch (error) {
    console.error('Rate template error:', error);
    sendResponse(res, 500, false, `Server error: ${(error as Error).message}`, null, error);
  }
};

export const updateTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, categoryId, actionSteps } = req.body;

    const template = await SharedPlanTemplate.findById(id);
    if (!template) {
      return sendResponse(res, 404, false, 'Template not found');
    }

    if (categoryId && !(await AttributeCategory.findById(categoryId))) {
      return sendResponse(res, 400, false, 'Invalid categoryId');
    }
    if (actionSteps && (!Array.isArray(actionSteps) || actionSteps.length === 0)) {
      return sendResponse(res, 400, false, 'At least one action step is required');
    }

    if (title) template.title = title;
    if (categoryId) template.categoryId = categoryId;
    if (actionSteps) {
      template.actionSteps = actionSteps.map((step: any, index: number) => ({
        stepNumber: index + 1,
        description: step.description,
      }));
    }

    await template.save();

    const populatedTemplate = await SharedPlanTemplate.findById(id)
      .populate('categoryId', 'name')
      .populate('createdBy', 'firstName lastName email');

    sendResponse(res, 200, true, 'Template updated successfully', populatedTemplate);
  } catch (error) {
    sendResponse(res, 500, false, 'Server error updating template', null, error);
  }
};


export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const template = await SharedPlanTemplate.findById(id);
    if (!template) {
      return sendResponse(res, 404, false, 'Template not found');
    }

    await template.deleteOne();

    sendResponse(res, 200, true, 'Template deleted successfully', { message: 'Template deleted successfully' });
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting template', null, error);
  }
};