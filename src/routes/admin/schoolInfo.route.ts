import express from "express";
import {
  createSchoolInfo,
  getSchoolInfo,
  updateSchoolInfo,
  updateBranding,        
  deleteSchoolInfo,
} from "../../controllers/admin/schoolInfo.controller.ts";
import { createUpload } from "../../middlewares/uploads.middleware.ts";
import { roleMiddleware } from "../../middlewares/role.middleware.ts";
import { authMiddleware } from "../../middlewares/auth.middleware.ts";

const router = express.Router();

const uploadSchoolLogo = createUpload('images/school');

router.post("/school-info", authMiddleware,
  roleMiddleware('admin') , uploadSchoolLogo.single('logo'), createSchoolInfo);
router.get("/school-info", authMiddleware,
  roleMiddleware('admin') ,  getSchoolInfo);
router.put("/school-info", authMiddleware,
  roleMiddleware('admin') , uploadSchoolLogo.single('logo'), updateSchoolInfo);
router.delete("/school-info", authMiddleware,
  roleMiddleware('admin') , deleteSchoolInfo);

router.patch("/school-info/branding", authMiddleware,
  roleMiddleware('admin') ,updateBranding);

export default router;