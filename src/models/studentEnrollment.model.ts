import { Schema, model, Types } from 'mongoose'
import { IStudentEnrollment } from '../types/studentEnrollment.type.js'

const studentEnrollmentSchema = new Schema<IStudentEnrollment>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    schoolYear: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
)

export const StudentEnrollment = model<IStudentEnrollment>(
  'StudentEnrollment',
  studentEnrollmentSchema
)
