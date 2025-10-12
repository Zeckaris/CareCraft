import { Document, Types } from 'mongoose'

export interface IStudentBadge extends Document {
  _id: Types.ObjectId
  badgeIds: Types.ObjectId[]
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  createdAt: Date
}
