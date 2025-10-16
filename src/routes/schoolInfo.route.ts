import express from "express";
import {
  createSchoolInfo,
  getSchoolInfo,
  updateSchoolInfo,
  deleteSchoolInfo,
} from "../controllers/schoolInfo.controller";

const router = express.Router();


router.post("/school", createSchoolInfo);
router.get("/school", getSchoolInfo);
router.put("/school", updateSchoolInfo);
router.delete("/school", deleteSchoolInfo);

export default router;
