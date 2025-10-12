import { Document, Types } from 'mongoose'

export interface IChatRoom extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  parentId?: Types.ObjectId | null
  createdAt: Date
}
