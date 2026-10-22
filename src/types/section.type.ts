import { Document, Types } from 'mongoose'

export interface ISection extends Document {
  _id: Types.ObjectId
  gradeId: Types.ObjectId
  schoolYear: string   // same format as StudentEnrollment.schoolYear e.g. "2024-2025"
  name: string         // e.g. "A", "B" — stored upper-case, unique per grade+year
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}
