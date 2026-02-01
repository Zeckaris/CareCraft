import { Request, Response } from "express";
import { SchoolInfo } from '../../models/schoolInfo.model.js';
import { sendResponse } from '../../utils/sendResponse.util.js';
import path from 'path';
import fs from 'fs';

// Branding validation constants (matching schema enums)
const VALID_THEMES = [
  'palette-1', 'palette-2', 'palette-3', 'palette-4', 'palette-5',
  'palette-6', 'palette-7', 'palette-8', 'palette-9', 'palette-10',
  'palette-11', 'palette-12'
] as const;

const VALID_FONTS = [
  'Roboto', 'Open Sans', 'Ubuntu', 'Lato', 'Montserrat',
  'Inter', 'Nunito', 'Source Sans Pro', 'Mountains of Christmas'
] as const;

type BrandingUpdate = {
  theme?: string;
  fontFamily?: string;
};

// Helper function to validate branding fields
const validateBrandingUpdate = (data: Partial<BrandingUpdate>): {
  isValid: boolean;
  errors: string[];
} => {
  const errors: string[] = [];

  if (data.theme && !VALID_THEMES.includes(data.theme as any)) {
    errors.push(`Invalid theme: '${data.theme}'. Must be one of: ${VALID_THEMES.join(', ')}`);
  }

  if (data.fontFamily && !VALID_FONTS.includes(data.fontFamily as any)) {
    errors.push(`Invalid font family: '${data.fontFamily}'. Must be one of: ${VALID_FONTS.join(', ')}`);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

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

    const schoolInfo = new SchoolInfo({
      ...req.body,
      logo: logoPath,
    });
    await schoolInfo.save();

    sendResponse(res, 201, true, "School info created successfully", schoolInfo);
  } catch (error: any) {
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map((err: any) => err.message);
      sendResponse(res, 400, false, "Validation failed", null, { details: validationErrors });
      return;
    }
    
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

    // Handle logo update
    if (req.file) {
      if (schoolInfo.logo) {
        const oldPath = path.join(import.meta.dirname, '..', '..', schoolInfo.logo);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      req.body.logo = `/uploads/images/school/${req.file.filename}`;
    }

    const updateData: any = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (value !== undefined && value !== null) {
        updateData[key] = value;
      }
    }

    const updatedInfo = await SchoolInfo.findByIdAndUpdate(
      schoolInfo._id, 
      updateData, 
      {
        new: true,
        runValidators: true,
      }
    );

    sendResponse(res, 200, true, "School info updated successfully", updatedInfo);
  } catch (error: any) {
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map((err: any) => err.message);
      sendResponse(res, 400, false, "Validation failed", null, { details: validationErrors });
      return;
    }
    
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};

export const updateBranding = async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolInfo = await SchoolInfo.findOne();
    if (!schoolInfo) {
      sendResponse(res, 404, false, "School info not found. Please create one first.");
      return;
    }

    const validation = validateBrandingUpdate(req.body);
    if (!validation.isValid) {
      sendResponse(res, 400, false, "Invalid branding configuration", null, { 
        details: validation.errors 
      });
      return;
    }

    const updateData: Partial<BrandingUpdate> = {};
    if (req.body.theme !== undefined) updateData.theme = req.body.theme;
    if (req.body.fontFamily !== undefined) updateData.fontFamily = req.body.fontFamily;

    const updatedInfo = await SchoolInfo.findByIdAndUpdate(
      schoolInfo._id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedInfo) {
      sendResponse(res, 404, false, "Failed to update branding – school info not found");
      return;
    }

    sendResponse(res, 200, true, "Branding updated successfully", {
      theme: updatedInfo.theme,
      fontFamily: updatedInfo.fontFamily,
    });
  } catch (error: any) {
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map((err: any) => err.message);
      sendResponse(res, 400, false, "Validation failed", null, { details: validationErrors });
      return;
    }
    
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};

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