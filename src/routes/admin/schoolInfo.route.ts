import express from "express";
import {
  createSchoolInfo,
  getSchoolInfo,
  updateSchoolInfo,
  updateBranding,
  updateSchoolFeatures,
  getBranding,
  deleteSchoolInfo,
} from '../../controllers/admin/schoolInfo.controller.js';
import multer from 'multer'; 
import { roleMiddleware } from '../../middlewares/role.middleware.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = express.Router();

const memoryUpload = multer({ storage: multer.memoryStorage() });

router.post("/school-info", authMiddleware,
  roleMiddleware('admin') , memoryUpload.single('logo'), createSchoolInfo); 
router.get("/school-info", authMiddleware,
  roleMiddleware('admin') ,  getSchoolInfo);
router.put("/school-info", authMiddleware,
  roleMiddleware('admin') , memoryUpload.single('logo'), updateSchoolInfo);  
router.delete("/school-info", authMiddleware,
  roleMiddleware('admin') , deleteSchoolInfo);

router.patch("/school-info/branding", authMiddleware,
  roleMiddleware('admin') ,updateBranding);

router.patch("/school-info/features", authMiddleware,
  roleMiddleware('admin') ,updateSchoolFeatures);

// Read-only branding for any authenticated user (no role restriction).
router.get("/school-info/branding", authMiddleware, getBranding);

export default router;