import { Schema, model } from 'mongoose'
import { IStudentBadge } from '../types/studentBadge.type.js'

const studentBadgeSchema = new Schema<IStudentBadge>(
  {
    badgeId: {
      type: Schema.Types.ObjectId,
      ref: 'BadgeDefinition',
      required: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    schoolYear: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    academicTermId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicTerm',
      required: true,
    },
    source: {
      type: String,
      enum: ['teacher', 'admin', 'system'],
      required: true,
    },
    /** Null only for future system awards. */
    awardedBy: {
      type: Schema.Types.ObjectId,
      ref: 'UserAccount',
      default: null,
    },
    note: { type: String, trim: true, default: '' },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
)

// A student may receive a specific badge at most once per term.
studentBadgeSchema.index(
  { studentId: 1, badgeId: 1, academicTermId: 1 },
  { unique: true, name: 'student_badge_term_unique' }
)
studentBadgeSchema.index({ studentId: 1, academicTermId: 1 })
studentBadgeSchema.index({ badgeId: 1 })
studentBadgeSchema.index({ schoolYear: 1 })

export const StudentBadge = model<IStudentBadge>(
  'StudentBadge',
  studentBadgeSchema
)
