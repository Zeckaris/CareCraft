import { Document, Types } from 'mongoose'

export interface IStudentEnrollment extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  gradeId: Types.ObjectId
  schoolYear: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
