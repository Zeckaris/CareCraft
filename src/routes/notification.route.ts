import express from 'express';
import {
  getUnreadNotifications,
  getReadNotifications,
  getAllNotifications,
  getUnreadCount,
  getTotalCount,
  markAsRead,
  markAllUnreadAsRead,
} from '../controllers/notification.controller.ts'
import { authMiddleware } from '../middlewares/auth.middleware.ts'


const router = express.Router();

// List endpoints
router.get('/unread', authMiddleware, getUnreadNotifications);
router.get('/read', authMiddleware, getReadNotifications);
router.get('/all', authMiddleware, getAllNotifications);

// Count endpoints
router.get('/unread-count', authMiddleware, getUnreadCount);
router.get('/total-count', authMiddleware, getTotalCount);

// Action endpoints
router.patch('/:id/read', authMiddleware, markAsRead);
router.patch('/read-all-unread', authMiddleware, markAllUnreadAsRead);


export default router;