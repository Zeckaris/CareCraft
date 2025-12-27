import mongoose, { Schema } from "mongoose";
import { ISchoolInfo } from "../types/schoolInfo.type.ts";

const SchoolInfoSchema = new Schema<ISchoolInfo>(
  {
    // Basic Identity
    name: { type: String, required: true, trim: true },
    motto: { type: String, default: "" },
    establishedYear: { type: Number, min: 1800, max: new Date().getFullYear() + 10 },

    // Contact
    address: { type: String, required: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    contactPhone: { type: String, required: true },
    alternatePhone: { type: String },
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