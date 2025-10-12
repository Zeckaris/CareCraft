import { Document, Types } from 'mongoose'

export interface IFlaggedIssue extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  issueType: string
  description: string
  linkedAttribute?: Types.ObjectId | null
  createdAt: Date
}
