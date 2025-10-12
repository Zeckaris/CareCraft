import { Document, Types } from "mongoose";

export interface ISchoolInfo extends Document {
  _id: Types.ObjectId;
  name: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  logo?: string | null;
  createdAt: Date;
  updatedAt: Date;
}
