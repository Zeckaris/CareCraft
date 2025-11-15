import { Document, Types } from 'mongoose';

export interface IAuditLog extends Document {
  type: string;
  message: string;
  actor: Types.ObjectId;  // Ref to UserAccount
  createdAt: Date;
}