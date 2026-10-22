import { Response } from 'express';
import { Notification } from '../models/notification.model.js';
import { Types } from 'mongoose';
import { sendResponse } from '../utils/sendResponse.util.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

// Optional pagination: only paginates when page and/or limit are provided so the
// original full-list response stays unchanged for existing callers.
const resolvePagination = (query: any): { paginated: boolean; page: number; limit: number; skip: number } => {
  const paginated = query.page !== undefined || query.limit !== undefined;
  const page = Math.max(1, parseInt(query.page as string) || 1);
  const limit = Math.max(1, parseInt(query.limit as string) || 20);
  return { paginated, page, limit, skip: (page - 1) * limit };
};

// GET /api/notifications/unread
export const getUnreadNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  const type = req.query.type as string || undefined;

  const filter: any = { userId: req.user!.id, isRead: false };
  if (type) filter.type = type;

  try {
    const { paginated, page, limit, skip } = resolvePagination(req.query);

    const query = Notification.find(filter).sort({ createdAt: -1 });
    if (paginated) query.skip(skip).limit(limit);
    const notifications = await query.lean();

    if (!paginated) {
      sendResponse(res, 200, true, 'Unread notifications fetched successfully', notifications);
      return;
    }

    const total = await Notification.countDocuments(filter);
    sendResponse(res, 200, true, 'Unread notifications fetched successfully', notifications, null, {
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Get unread notifications error:', error);
    sendResponse(res, 500, false, 'Internal server error', null, error);
  }
};

// GET /api/notifications/read
export const getReadNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  const type = req.query.type as string || undefined;
  const sort = req.query.sort as string || '-createdAt';

  const filter: any = { userId: req.user!.id, isRead: true };
  if (type) filter.type = type;

  try {
    const { paginated, page, limit, skip } = resolvePagination(req.query);

    const query = Notification.find(filter).sort(sort);
    if (paginated) query.skip(skip).limit(limit);
    const notifications = await query.lean();

    if (!paginated) {
      sendResponse(res, 200, true, 'Read notifications fetched successfully', notifications);
      return;
    }

    const total = await Notification.countDocuments(filter);
    sendResponse(res, 200, true, 'Read notifications fetched successfully', notifications, null, {
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Get read notifications error:', error);
    sendResponse(res, 500, false, 'Internal server error', null, error);
  }
};

// GET /api/notifications/all
export const getAllNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  const type = req.query.type as string || undefined;
  const sort = req.query.sort as string || '-createdAt';

  const filter: any = { userId: req.user!.id };
  if (type) filter.type = type;

  try {
    const { paginated, page, limit, skip } = resolvePagination(req.query);

    const query = Notification.find(filter).sort(sort);
    if (paginated) query.skip(skip).limit(limit);
    const notifications = await query.lean();

    if (!paginated) {
      sendResponse(res, 200, true, 'All notifications fetched successfully', notifications);
      return;
    }

    const total = await Notification.countDocuments(filter);
    sendResponse(res, 200, true, 'All notifications fetched successfully', notifications, null, {
      total,
      page,
      limit,
    });
  } catch (error) {
    console.error('Get all notifications error:', error);
    sendResponse(res, 500, false, 'Internal server error', null, error);
  }
};

// GET /api/notifications/unread-count
export const getUnreadCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const unreadCount = await Notification.countDocuments({ userId: req.user!.id, isRead: false });
    sendResponse(res, 200, true, 'Unread count fetched successfully', { unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    sendResponse(res, 500, false, 'Internal server error', null, error);
  }
};

// GET /api/notifications/total-count
export const getTotalCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const totalCount = await Notification.countDocuments({ userId: req.user!.id });
    sendResponse(res, 200, true, 'Total count fetched successfully', { totalCount });
  } catch (error) {
    console.error('Get total count error:', error);
    sendResponse(res, 500, false, 'Internal server error', null, error);
  }
};

// PATCH /api/notifications/:id/read
export const markAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Invalid notification ID');
    return;
  }

  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId: req.user!.id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      sendResponse(res, 404, false, 'Notification not found or not owned by user');
      return;
    }

    sendResponse(res, 200, true, 'Notification marked as read', notification);
  } catch (error) {
    console.error('Mark as read error:', error);
    sendResponse(res, 500, false, 'Internal server error', null, error);
  }
};

// PATCH /api/notifications/read-all-unread
export const markAllUnreadAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user!.id, isRead: false },
      { isRead: true }
    );

    sendResponse(res, 200, true, 'All unread notifications marked as read', { updatedCount: result.modifiedCount });
  } catch (error) {
    console.error('Mark all unread as read error:', error);
    sendResponse(res, 500, false, 'Internal server error', null, error);
  }
};

// DELETE /api/notifications/:id
export const deleteNotification = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  if (!Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Invalid notification ID');
    return;
  }

  try {
    const notification = await Notification.findOneAndDelete({ _id: id, userId: req.user!.id });

    if (!notification) {
      sendResponse(res, 404, false, 'Notification not found or not owned by user');
      return;
    }

    sendResponse(res, 200, true, 'Notification deleted successfully');
  } catch (error) {
    console.error('Delete notification error:', error);
    sendResponse(res, 500, false, 'Internal server error', null, error);
  }
};