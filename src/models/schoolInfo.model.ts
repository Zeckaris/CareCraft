import mongoose, { Schema, Types } from "mongoose";
import { ISchoolInfo } from "../types/schoolInfo.type.ts";

const SchoolInfoSchema = new Schema<ISchoolInfo>(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    contactPhone: { type: String, required: true },
    logo: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

export const SchoolInfo = mongoose.model<ISchoolInfo>("SchoolInfo", SchoolInfoSchema);
