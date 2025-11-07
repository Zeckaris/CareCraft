import { Schema, model, Types } from 'mongoose'
import { IReport } from '../types/report.type.ts'

const reportSchema = new Schema<IReport>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    academicSummary: { type: String, required: true },
    behavioralSummary: { type: String, required: true },
    recommendations: { type: String, required: true },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const Report = model<IReport>('Report', reportSchema)
