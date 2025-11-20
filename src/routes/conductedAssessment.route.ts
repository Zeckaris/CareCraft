import express from 'express';
import {
  getAllConducted,
  getCurrentTermConducted,
  getConductedById,
  createConducted,
  markStageConducted,
  updateStatus,
} from '../controllers/conductedAssessment.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';


const router = express.Router();

// Anyone logged in can see current term's conducted assessments
router.get('/current-term', authMiddleware, getCurrentTermConducted);


router.patch('/:id/mark-stage', 
  authMiddleware, 
  roleMiddleware('admin', 'coordinator', 'teacher'), 
  markStageConducted
);

// Admin + Coordinator only for everything else
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator'), getAllConducted);
router.get('/:id', authMiddleware, roleMiddleware('admin', 'coordinator'), getConductedById);
router.post('/', authMiddleware, roleMiddleware('admin', 'coordinator'), createConducted);
router.put('/:id/status', authMiddleware, roleMiddleware('admin', 'coordinator'), updateStatus);

export default router;