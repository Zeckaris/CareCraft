import { Document, Types } from 'mongoose'

export interface IStudentEnrollment extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  gradeId: Types.ObjectId
  sectionId?: Types.ObjectId | null  // optional – populated after sections exist
  sectionName?: string               // virtual additive field when sectionId is populated
  schoolYear: string
  isActive: boolean
  registrationWindowOverride?: {
    reason: string
    by: Types.ObjectId
    at: Date
  } | null
  createdAt: Date
  updatedAt: Date
}
