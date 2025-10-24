import { Request, Response } from 'express';
import { Types } from 'mongoose';
import {SharedPlanTemplate} from '../models/sharedPlanTemplate.model';
import {ActionPlan} from '../models/actionPlan.model';
import {AttributeCategory} from '../models/attributeCategory.model';
import {Student} from '../models/student.model';
import UserAccount from '../models/userAccount.model';

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
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!title || !categoryId) {
      return res.status(400).json({ error: 'Title and categoryId are required' });
    }

    if (!Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({ error: 'Invalid categoryId format' });
    }

    const actionPlan = await ActionPlan.findById(actionPlanId);
    if (!actionPlan) {
      return res.status(404).json({ error: 'ActionPlan not found' });
    }

    const category = await AttributeCategory.findById(categoryId);
    if (!category) {
      return res.status(400).json({ error: 'Invalid categoryId: Category not found' });
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
      return res.status(500).json({ error: 'Failed to populate template' });
    }

    res.status(201).json({ data: populatedTemplate });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: `Server error: ${(error as Error).message}` });
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

    res.status(200).json({
      data: templates,
      total,
      page: Number(page),
      limit: Number(limit),
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const getTemplateById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const template = await SharedPlanTemplate.findById(id)
      .populate('categoryId', 'name')
      .populate('createdBy', 'firstName lastName email');

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.status(200).json({ data: template });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};


export const applyTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { studentId, teacherId, issue, goal, startDate, endDate } = req.body;

    console.log('Apply template - Request body:', req.body);
    console.log('Apply template - User:', req.user);

    if (!studentId || !teacherId || !issue || !goal || !startDate || !endDate) {
      return res.status(400).json({ error: 'All fields (studentId, teacherId, issue, goal, startDate, endDate) are required' });
    }

    const template = await SharedPlanTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Check if student and teacher exist
    const [student, teacher] = await Promise.all([
      Student.findById(studentId),
      UserAccount.findById(teacherId),
    ]);
    if (!student) {
      return res.status(400).json({ error: 'Invalid studentId' });
    }
    if (!teacher || !['teacher', 'admin'].includes(teacher.role)) {
      return res.status(400).json({ error: 'Invalid teacherId: User must have teacher or admin role' });
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

    res.status(201).json({ data: populatedActionPlan });
  } catch (error) {
    console.error('Apply template error:', error);
    res.status(500).json({ error: `Server error: ${(error as Error).message}` });
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
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const template = await SharedPlanTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const userId = new Types.ObjectId(user.id);
    if (template.ratedBy.some((id) => id.equals(userId))) {
      return res.status(400).json({ error: 'You have already rated this template' });
    }

    template.rating = (template.rating * template.ratingCount + rating) / (template.ratingCount + 1);
    template.ratingCount += 1;
    template.ratedBy.push(userId);

    await template.save();
    console.log('Template rated:', template._id, 'RatedBy:', template.ratedBy);

    const populatedTemplate = await SharedPlanTemplate.findById(id)
      .populate('categoryId', 'name')
      .populate('createdBy', 'firstName lastName email');

    res.status(200).json({ data: populatedTemplate });
  } catch (error) {
    console.error('Rate template error:', error);
    res.status(500).json({ error: `Server error: ${(error as Error).message}` });
  }
};

export const updateTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, categoryId, actionSteps } = req.body;

    const template = await SharedPlanTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (categoryId && !(await AttributeCategory.findById(categoryId))) {
      return res.status(400).json({ error: 'Invalid categoryId' });
    }
    if (actionSteps && (!Array.isArray(actionSteps) || actionSteps.length === 0)) {
      return res.status(400).json({ error: 'At least one action step is required' });
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

    res.status(200).json({ data: populatedTemplate });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};


export const deleteTemplate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const template = await SharedPlanTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    await template.deleteOne();

    res.status(200).json({ data: { message: 'Template deleted successfully' } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};