import express from 'express';
import {
  getAllObservations,
  getObservationById,
  createObservation,
  updateObservation,
  deleteObservation
} from '../controllers/observation.controller';
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';

const router = express.Router();


router.get('/', authMiddleware, getAllObservations);
router.get('/:id', authMiddleware, getObservationById);


router.post('/', authMiddleware, roleMiddleware('teacher'), createObservation);


router.put('/:id', authMiddleware, roleMiddleware('teacher'), updateObservation);


router.delete('/:id', authMiddleware, roleMiddleware('teacher'), deleteObservation);

export default router;