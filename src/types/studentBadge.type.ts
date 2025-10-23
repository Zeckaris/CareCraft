import { Document, Types } from 'mongoose'

export interface IStudentBadge extends Document {
  _id: Types.ObjectId
  badgeId: Types.ObjectId
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  criteriaMet: boolean
  createdAt: Date
}
