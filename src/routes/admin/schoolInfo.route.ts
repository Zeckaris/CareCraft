import express from "express";
import {
  createSchoolInfo,
  getSchoolInfo,
  updateSchoolInfo,
  deleteSchoolInfo,
} from "../../controllers/admin/schoolInfo.controller";
import { createUpload } from "../../middlewares/uploads.middleware";

const router = express.Router();

const uploadSchoolLogo = createUpload('images/school');

router.post("/school", uploadSchoolLogo.single('logo'), createSchoolInfo);
router.get("/school", getSchoolInfo);
router.put("/school", uploadSchoolLogo.single('logo'), updateSchoolInfo);
router.delete("/school", deleteSchoolInfo);

export default router;
