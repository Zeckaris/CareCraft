import { Request, Response } from "express";
import { SchoolInfo } from '../../models/schoolInfo.model.js';
import { sendResponse } from '../../utils/sendResponse.util.js';

// Cloudinary integration
import { uploadToCloudinary, deleteFromCloudinary } from '../../utils/cloudinary.util.js';

const TELEPHONE_ENTRY_RE = /^[0-9+\-() ]{6,20}$/;
const ABOUT_MAX_LENGTH = 2000;

type TelephoneInput =
  | { ok: true; present: boolean; values: string[] }
  | { ok: false; message: string };

type AboutInput =
  | { ok: true; present: boolean; value?: string }
  | { ok: false; message: string };

const hasOwn = (value: any, key: string): boolean =>
  !!value && Object.prototype.hasOwnProperty.call(value, key);

function parseTelephoneInput(body: any): TelephoneInput {
  const bracketField = "telephone[]";
  const present = hasOwn(body, bracketField) || hasOwn(body, "telephone");
  if (!present) return { ok: true, present: false, values: [] };

  const rawValues: unknown[] = [];
  const append = (value: unknown): void => {
    if (Array.isArray(value)) rawValues.push(...value);
    else rawValues.push(value);
  };

  if (hasOwn(body, bracketField)) append(body[bracketField]);
  if (hasOwn(body, "telephone")) append(body.telephone);

  const entries: string[] = [];
  for (const raw of rawValues) {
    if (typeof raw !== "string") {
      return { ok: false, message: "telephone entries must be strings" };
    }

    const value = raw.trim();
    if (value.startsWith("[")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return {
          ok: false,
          message:
            "telephone must be sent as repeated telephone[] fields or a JSON-encoded array string",
        };
      }
      if (!Array.isArray(parsed)) {
        return {
          ok: false,
          message:
            "telephone must be sent as repeated telephone[] fields or a JSON-encoded array string",
        };
      }
      for (const item of parsed) {
        if (typeof item !== "string") {
          return { ok: false, message: "telephone entries must be strings" };
        }
        entries.push(item.trim());
      }
    } else {
      entries.push(value);
    }
  }

  if (entries.some((entry) => entry.length === 0)) {
    return { ok: false, message: "telephone entries cannot be empty" };
  }

  if (entries.some((entry) => !TELEPHONE_ENTRY_RE.test(entry))) {
    return {
      ok: false,
      message:
        "telephone entries must be 6-20 characters using digits, spaces, +, -, (, )",
    };
  }

  const values = Array.from(new Set(entries));
  if (values.length < 1 || values.length > 5) {
    return {
      ok: false,
      message: "telephone must contain between 1 and 5 unique entries",
    };
  }

  return { ok: true, present: true, values };
}

function parseAboutInput(body: any): AboutInput {
  if (!hasOwn(body, "about")) return { ok: true, present: false };

  if (typeof body.about !== "string") {
    return { ok: false, message: "about must be a string" };
  }

  const value = body.about.trim();
  if (value.length > ABOUT_MAX_LENGTH) {
    return {
      ok: false,
      message: `about must not exceed ${ABOUT_MAX_LENGTH} characters`,
    };
  }

  return { ok: true, present: true, value };
}

function deriveTelephone(source: any): string[] {
  const stored = Array.isArray(source?.telephone)
    ? source.telephone
        .filter((value: unknown) => typeof value === "string")
        .map((value: string) => value.trim())
        .filter(Boolean)
    : [];

  if (stored.length > 0) return stored;

  const contactPhone =
    typeof source?.contactPhone === "string" ? source.contactPhone.trim() : "";
  if (contactPhone) return [contactPhone];

  const alternatePhone =
    typeof source?.alternatePhone === "string" ? source.alternatePhone.trim() : "";
  if (alternatePhone) return [alternatePhone];

  return [];
}

function serializeSchoolInfo(schoolInfo: any): any {
  if (!schoolInfo) return schoolInfo;
  const object =
    typeof schoolInfo.toObject === "function"
      ? schoolInfo.toObject()
      : { ...schoolInfo };
  object.telephone = deriveTelephone(object);
  return object;
}

function stripTelephoneFields(body: any): any {
  const data = { ...(body ?? {}) };
  delete data["telephone[]"];
  delete data.telephone;
  return data;
}

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

    const telephone = parseTelephoneInput(req.body);
    if (!telephone.ok) {
      sendResponse(res, 400, false, telephone.message);
      return;
    }
    if (!telephone.present) {
      sendResponse(res, 400, false, "At least one telephone number is required");
      return;
    }

    const about = parseAboutInput(req.body);
    if (!about.ok) {
      sendResponse(res, 400, false, about.message);
      return;
    }

    let logoPath: string | null = null;
    if (req.file) {
      const { url } = await uploadToCloudinary(
        req.file.buffer,
        'images/school',  // Cloudinary folder
        undefined,
        'image'
      );
      logoPath = url;
    }

    const bodyData = stripTelephoneFields(req.body);
    if (about.present) bodyData.about = about.value;

    const schoolInfo = new SchoolInfo({
      ...bodyData,
      telephone: telephone.values,
      logo: logoPath,
    });
    await schoolInfo.save();

    sendResponse(
      res,
      201,
      true,
      "School info created successfully",
      serializeSchoolInfo(schoolInfo)
    );
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
    sendResponse(
      res,
      200,
      true,
      "School info fetched successfully",
      serializeSchoolInfo(schoolInfo)
    );
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};

// Read-only branding for any authenticated user (teacher/parent/student apps).
// Returns only non-sensitive branding fields, with defaults when no school info exists.
export const getBranding = async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolInfo = await SchoolInfo.findOne()
      .select('name logo theme fontFamily')
      .lean();

    if (!schoolInfo) {
      sendResponse(res, 200, true, "School branding fetched successfully", {
        name: null,
        logo: null,
        theme: "palette-1",
        fontFamily: "Roboto",
      });
      return;
    }

    sendResponse(res, 200, true, "School branding fetched successfully", {
      name: schoolInfo.name,
      logo: schoolInfo.logo ?? null,
      theme: schoolInfo.theme,
      fontFamily: schoolInfo.fontFamily,
    });
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

    const telephone = parseTelephoneInput(req.body);
    if (!telephone.ok) {
      sendResponse(res, 400, false, telephone.message);
      return;
    }

    const about = parseAboutInput(req.body);
    if (!about.ok) {
      sendResponse(res, 400, false, about.message);
      return;
    }

    let logoPath: string | null | undefined = schoolInfo.logo;
    if (req.file) {
      // Delete old logo if exists
      if (schoolInfo.logo) {
        try {
          const urlParts = schoolInfo.logo.split('/');
          const filenameWithExt = urlParts[urlParts.length - 1];
          const publicId = urlParts.slice(-2, -1)[0] + '/' + filenameWithExt.split('.')[0];
          await deleteFromCloudinary(publicId);
        } catch (deleteErr) {
          console.warn('Failed to delete old Cloudinary logo:', deleteErr);
        }
      }

      const { url } = await uploadToCloudinary(
        req.file.buffer,
        'images/school',
        undefined,
        'image'
      );
      logoPath = url;
    }

    const updateData: any = {
      ...stripTelephoneFields(req.body),
      logo: logoPath,
    };
    if (telephone.present) updateData.telephone = telephone.values;
    if (about.present) updateData.about = about.value;

    const updatedInfo = await SchoolInfo.findByIdAndUpdate(
      schoolInfo._id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    );

    sendResponse(
      res,
      200,
      true,
      "School info updated successfully",
      serializeSchoolInfo(updatedInfo)
    );
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

    // Optional: delete logo from Cloudinary
    if (schoolInfo.logo) {
      try {
        const urlParts = schoolInfo.logo.split('/');
        const filenameWithExt = urlParts[urlParts.length - 1];
        const publicId = urlParts.slice(-2, -1)[0] + '/' + filenameWithExt.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (deleteErr) {
        console.warn('Failed to delete Cloudinary logo on delete:', deleteErr);
      }
    }

    await SchoolInfo.findByIdAndDelete(schoolInfo._id);
    sendResponse(res, 200, true, "School info deleted successfully");
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};