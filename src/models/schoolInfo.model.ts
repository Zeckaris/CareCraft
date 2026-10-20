import mongoose, { Schema } from "mongoose";
import { ISchoolInfo } from '../types/schoolInfo.type.js';

const TELEPHONE_ENTRY_RE = /^[0-9+\-() ]{6,20}$/;

const SchoolInfoSchema = new Schema<ISchoolInfo>(
  {
    // Basic Identity
    name: { type: String, required: true, trim: true },
    motto: { type: String, default: "" },
    about: { type: String, default: "", trim: true, maxlength: 2000 },
    establishedYear: { type: Number, min: 1800, max: new Date().getFullYear() + 10 },

    // Contact
    address: { type: String, required: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    telephone: {
      type: [{ type: String, trim: true }],
      default: [],
      validate: [
        {
          validator: (values: string[]) =>
            Array.isArray(values) &&
            values.every(
              (value) => typeof value === "string" && TELEPHONE_ENTRY_RE.test(value.trim())
            ),
          message:
            "telephone entries must be 6-20 characters using digits, spaces, +, -, (, )",
        },
        {
          validator: (values: string[]) =>
            Array.isArray(values) &&
            values.length <= 5 &&
            values.every((value) => typeof value === "string") &&
            new Set(values.map((value) => value.trim())).size === values.length,
          message: "telephone must contain at most 5 unique entries",
        },
      ],
    },
    /** @deprecated Use telephone. Kept for legacy clients and reads. */
    contactPhone: { type: String, trim: true },
    /** @deprecated Use telephone. Kept for legacy clients and reads. */
    alternatePhone: { type: String, trim: true },
    website: { type: String },

   // Visual Branding
    logo: { type: String, default: null },
    theme: {
      type: String,
      enum: ['palette-1', 'palette-2', 'palette-3', 'palette-4', 'palette-5', 'palette-6', 'palette-7', 'palette-8', 'palette-9', 'palette-10', 'palette-11', 'palette-12'],
      default: 'palette-1',
    },
    fontFamily: {
      type: String,
      default: 'Roboto',
      enum: [
        'Roboto',
        'Open Sans',
        'Ubuntu',
        'Lato',
        'Montserrat',
        'Inter',
        'Nunito',
        'Source Sans Pro',
        'Mountains of Christmas',
      ],
    },

    // Location
    city: { type: String },
    state: { type: String },
    country: { type: String, default: "Ethiopia" },
    timezone: { type: String, default: "Africa/Addis_Ababa" },

    // Academic Configuration
    academicStructure: {
      type: String,
      enum: ["Semester", "Term", "Quarter", "Trimester", "Custom"],
      default: "Semester",
    },
    numberOfPeriods: {
      type: Number,
      min: 1,
      max: 6,
      default: 2, // typical for Semester
    },
    defaultPassingScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 50,
    },
    gradingSystem: {
      type: String,
      enum: ["Percentage", "Letter (A-F)", "Grade Points (4.0)", "Custom"],
      default: "Percentage",
    },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

export const SchoolInfo = mongoose.model<ISchoolInfo>("SchoolInfo", SchoolInfoSchema);