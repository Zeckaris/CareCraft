import { Document, Types } from 'mongoose'

export interface IReport extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  academicSummary: string
  behavioralSummary: string
  recommendations: string
  createdAt: Date
}
