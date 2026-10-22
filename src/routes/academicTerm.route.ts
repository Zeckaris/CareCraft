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
} from '../controllers/academicTerm.controller.js'
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { roleMiddleware } from '../middlewares/role.middleware.js';


const router = express.Router();


router.get('/current', authMiddleware, getCurrentTerm);

// Any authenticated staff member (including teachers) may read the term list
// for selectors. Writes and the per-calendar read stay admin/coordinator-only.
router.get('/', authMiddleware, roleMiddleware('admin', 'coordinator', 'teacher'), getAllTerms);


router.use(authMiddleware, roleMiddleware('admin', 'coordinator'));

router.get('/calendar/:calendarId', getTermsByCalendar);
router.get('/:id', getTermById);
router.post('/', createTerm);
router.put('/:id', updateTerm);
router.patch('/:id/current', setCurrentTerm);
router.delete('/:id', deleteTerm);

export default router;