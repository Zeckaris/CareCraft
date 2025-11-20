import express from 'express';
import {
  getAllTerms,
  getCurrentTerm,
  getTermsByCalendar,
  getTermById,
  createTerm,
  updateTerm,
  setCurrentTerm,
  deleteTerm,
} from '../controllers/academicTerm.controller'
import { authMiddleware } from '../middlewares/auth.middleware';
import { roleMiddleware } from '../middlewares/role.middleware';


const router = express.Router();


router.get('/current', authMiddleware, getCurrentTerm);


router.use(authMiddleware, roleMiddleware('admin', 'coordinator'));

router.get('/', getAllTerms);
router.get('/calendar/:calendarId', getTermsByCalendar);
router.get('/:id', getTermById);
router.post('/', createTerm);
router.put('/:id', updateTerm);
router.patch('/:id/current', setCurrentTerm);
router.delete('/:id', deleteTerm);

export default router;