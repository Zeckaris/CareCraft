import express from 'express';
import {
  getAllCalendars,
  getCurrentCalendar,
  getCurrentAcademicContext,
  getCalendarById,
  createCalendar,
  updateCalendar,
  setCurrentCalendar,
  deleteCalendar,
} from '../controllers/academicCalendar.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';


const router = express.Router();


router.get('/current', authMiddleware, getCurrentCalendar);
router.get('/current-context', authMiddleware, getCurrentAcademicContext);


router.use(authMiddleware, roleMiddleware('admin', 'coordinator'));

router.get('/', getAllCalendars);
router.get('/:id', getCalendarById);
router.post('/', createCalendar);
router.put('/:id', updateCalendar);
router.patch('/:id/current', setCurrentCalendar);
router.delete('/:id', deleteCalendar);

export default router;