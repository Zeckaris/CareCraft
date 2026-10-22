import { Document, Types } from 'mongoose'

export interface IBadgeAwardSuppression extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  badgeId: Types.ObjectId
  academicTermId: Types.ObjectId
  createdBy: Types.ObjectId
  createdAt: Date
}
