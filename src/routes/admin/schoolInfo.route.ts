import express from "express";
import {
  createSchoolInfo,
  getSchoolInfo,
  updateSchoolInfo,
  updateBranding,        
  deleteSchoolInfo,
} from "../../controllers/admin/schoolInfo.controller.ts";
import { createUpload } from "../../middlewares/uploads.middleware.ts";

const router = express.Router();

const uploadSchoolLogo = createUpload('images/school');

router.post("/school-info", uploadSchoolLogo.single('logo'), createSchoolInfo);
router.get("/school-info", getSchoolInfo);
router.put("/school-info", uploadSchoolLogo.single('logo'), updateSchoolInfo);
router.delete("/school-info", deleteSchoolInfo);

router.patch("/school-info/branding", updateBranding);

export default router;