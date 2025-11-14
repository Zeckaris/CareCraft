import express from 'express';
import { getAllTeachers, getAllParents, getAllCoordinators,updateUser,deleteUser  } from '../../controllers/admin/adminUser.controller.ts';
import { authMiddleware } from '../../middlewares/auth.middleware.ts';
import { roleMiddleware } from '../../middlewares/role.middleware.ts';

const router = express.Router();


router.get('/coordinators',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getAllCoordinators
);

router.get('/teachers',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getAllTeachers
);

router.get('/parents',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  getAllParents
);

router.put('/users/:id',
  authMiddleware,
  roleMiddleware('admin', 'coordinator'),
  updateUser
);

router.delete('/users/:id',
  authMiddleware,
  roleMiddleware('admin'),  
  deleteUser
);

export default router;