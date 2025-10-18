import { Document, Types } from "mongoose";

export interface IGrade extends Document {
  _id: Types.ObjectId;
  level: number;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
