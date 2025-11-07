import { Request, Response } from "express";
import { SchoolInfo } from "../../models/schoolInfo.model.ts";
import { sendResponse } from '../../utils/sendResponse.util.ts';
import path from 'path';
import fs from 'fs';


export const createSchoolInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await SchoolInfo.findOne();
    if (existing) {
      sendResponse(res, 400, false, "School info already exists. Please update instead.");
      return;
    }

    const logoPath = req.file 
      ? `/uploads/images/school/${req.file.filename}` 
      : null;

    const schoolInfo = new SchoolInfo({...req.body,
      logo: logoPath,
    });
    await schoolInfo.save();

    sendResponse(res, 201, true, "School info created successfully", schoolInfo);
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};


export const getSchoolInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolInfo = await SchoolInfo.findOne();
    if (!schoolInfo) {
      sendResponse(res, 404, false, "School info not found");
      return;
    }

    sendResponse(res, 200, true, "School info fetched successfully", schoolInfo);
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};


export const updateSchoolInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolInfo = await SchoolInfo.findOne();
    if (!schoolInfo) {
      sendResponse(res, 404, false, "School info not found. Please create one first.");
      return;
    }
    if (req.file) {
      // Delete old logo
      if (schoolInfo.logo) {
        const oldPath = path.join(__dirname, '..', '..', schoolInfo.logo);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      req.body.logo = `/uploads/images/school/${req.file.filename}`;
    }

    const updatedInfo = await SchoolInfo.findByIdAndUpdate(schoolInfo._id, req.body, {
      new: true,
      runValidators: true,
    });

    sendResponse(res, 200, true, "School info updated successfully", updatedInfo);
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};

// Incase
export const deleteSchoolInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolInfo = await SchoolInfo.findOne();
    if (!schoolInfo) {
      sendResponse(res, 404, false, "School info not found");
      return;
    }

    await SchoolInfo.findByIdAndDelete(schoolInfo._id);
    sendResponse(res, 200, true, "School info deleted successfully");
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};
