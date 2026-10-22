import { Schema, model } from 'mongoose'
import { IWeeklyPeriodRequirement } from '../types/weeklyPeriodRequirement.type.js'
import { DOUBLE_PERIOD_OPTIONS } from '../utils/scheduleSetting.util.js'

const weeklyPeriodRequirementSchema = new Schema<IWeeklyPeriodRequirement>(
  {
    schoolYear: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    periodsPerWeek: { type: Number, required: true, min: 1 },
    doublePeriod: { type: String, enum: DOUBLE_PERIOD_OPTIONS, default: 'none' },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

// One requirement per school year + grade + subject.
weeklyPeriodRequirementSchema.index(
  { schoolYear: 1, gradeId: 1, subjectId: 1 },
  { unique: true }
)

export const WeeklyPeriodRequirement = model<IWeeklyPeriodRequirement>(
  'WeeklyPeriodRequirement',
  weeklyPeriodRequirementSchema
)
