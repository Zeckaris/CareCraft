import { Schema, model } from 'mongoose'
import { IObservation } from '../types/observation.type.js'

const observationSchema = new Schema<IObservation>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    date: { type: Date, required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    schoolYear: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    term: { type: Schema.Types.ObjectId, ref: 'AcademicTerm', required: true },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

observationSchema.index({ studentId: 1, date: -1 })
observationSchema.index({ teacherId: 1, date: -1 })
observationSchema.index({ subjectId: 1, date: -1 })
observationSchema.index({ schoolYear: 1, term: 1, date: -1 })
observationSchema.index({ studentId: 1, schoolYear: 1, term: 1 })
observationSchema.index({ teacherId: 1, schoolYear: 1, term: 1 })

export const Observation = model<IObservation>('Observation', observationSchema)
