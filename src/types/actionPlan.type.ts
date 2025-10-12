import { Document, Types } from 'mongoose'

export interface IActionPlan extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  issue: string
  goal: string
  actionSteps: string
  progressRating: number
  startDate: Date
  endDate?: Date | null
  createdAt: Date
}
