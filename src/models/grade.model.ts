import mongoose, { Schema, Types } from "mongoose";
import { IGrade } from "../types/grade.type";

const GradeSchema = new Schema<IGrade>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

export const Grade = mongoose.model<IGrade>("Grade", GradeSchema);
