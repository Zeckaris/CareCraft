import { Document, Types } from 'mongoose'

export interface IProgressUpdate extends Document {
  _id: Types.ObjectId
  actionPlanId: Types.ObjectId
  studentId: Types.ObjectId
  teacherId?: Types.ObjectId | null
  parentId?: Types.ObjectId | null
  note: string
  createdAt: Date
}
