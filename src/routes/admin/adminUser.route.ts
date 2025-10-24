import express from 'express';
import { getAllTeachers, getAllParents } from '../../controllers/admin/adminUser.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { roleMiddleware } from '../../middlewares/role.middleware';

const router = express.Router();

router.get('/teachers', authMiddleware, roleMiddleware('admin'), getAllTeachers);
router.get('/parents', authMiddleware, roleMiddleware('admin'), getAllParents);

export default router;