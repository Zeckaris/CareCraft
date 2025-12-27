import { Document, Types } from "mongoose";

export interface ISchoolInfo extends Document {
  _id: Types.ObjectId;

  // Basic Identity
  name: string;
  motto?: string;
  establishedYear?: number;

  // Contact
  address: string;
  contactEmail: string;
  contactPhone: string;
  alternatePhone?: string;
  website?: string;

  // Visual Branding
  logo?: string | null;
  theme: 'palette-1' | 'palette-2' | 'palette-3' | 'palette-4' | 'palette-5' | 'palette-6' | 'palette-7';
  fontFamily: 'Roboto' | 'Open Sans' | 'Ubuntu' | 'Lato' | 'Montserrat' | 'Inter' | 'Nunito' | 'Source Sans Pro' | "Mountains of Christmas";

  // Location
  city?: string;
  state?: string;
  country: string;
  timezone: string;

  // Academic Configuration
  academicStructure: "Semester" | "Term" | "Quarter" | "Trimester" | "Custom";
  numberOfPeriods?: number;
  defaultPassingScore: number;
  gradingSystem: "Percentage" | "Letter (A-F)" | "Grade Points (4.0)" | "Custom";

  createdAt: Date;
  updatedAt: Date;
}