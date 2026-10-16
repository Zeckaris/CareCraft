import { Schema, model, Types } from 'mongoose'
import { IStudentEnrollment } from '../types/studentEnrollment.type.js'

const studentEnrollmentSchema = new Schema<IStudentEnrollment>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', default: null },
    schoolYear: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    isActive: { type: Boolean, default: true }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
)

// Additive virtual field: sectionName
studentEnrollmentSchema.virtual('sectionName').get(function (this: any) {
  if (this.sectionId && typeof this.sectionId === 'object' && 'name' in this.sectionId) {
    return this.sectionId.name
  }
  return undefined
})

// Index for fast "all enrollments in a section" queries
studentEnrollmentSchema.index({ sectionId: 1, isActive: 1 })

export const StudentEnrollment = model<IStudentEnrollment>(
  'StudentEnrollment',
  studentEnrollmentSchema
)
