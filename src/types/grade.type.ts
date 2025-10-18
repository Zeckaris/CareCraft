import { Document, Types } from "mongoose";

export interface IGrade extends Document {
  _id: Types.ObjectId;
  level: string;
  description?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
