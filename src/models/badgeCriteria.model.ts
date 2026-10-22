import { Schema, model } from 'mongoose'
import { IBadgeCriteria } from '../types/badgeCriteria.type.js'
import {
  BADGE_CRITERIA_SCOPES,
  BADGE_CRITERIA_TYPES,
  BADGE_STREAK_MODES,
} from '../badges/criteriaRegistry.js'

const badgeCriteriaSchema = new Schema<IBadgeCriteria>(
  {
    badgeDefinitionId: {
      type: Schema.Types.ObjectId,
      ref: 'BadgeDefinition',
      required: true,
    },
    type: {
      type: String,
      enum: [...BADGE_CRITERIA_TYPES],
      required: true,
    },
    attributeCategoryId: {
      type: Schema.Types.ObjectId,
      ref: 'AttributeCategory',
      default: null,
    },
    minScore: { type: Number, default: null },
    minPercentage: { type: Number, default: null },
    /** attendanceRate: recorded school days required before evaluation. */
    minRecordedSchoolDays: { type: Number, default: null },
    /** Legacy phase-1 field; ignored by the evaluator and cleared by migration. */
    minLockedWeightPercentage: { type: Number, default: null },
    /** attributeAverage: evaluations required before evaluation. */
    minEvaluationCount: { type: Number, default: null },
    /** academicAverage: null means the overall average. */
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      default: null,
    },
    /** attendanceStreak: noAbsence or onTime. */
    mode: {
      type: String,
      enum: [...BADGE_STREAK_MODES],
      default: null,
    },
    /** attendanceStreak: minimum longest streak in recorded school days. */
    minDays: { type: Number, default: null },
    /** academicImprovement: minimum percentage-point improvement. */
    minPoints: { type: Number, default: null },
    scope: {
      type: String,
      enum: [...BADGE_CRITERIA_SCOPES],
      default: null,
    },
    description: { type: String, trim: true, default: '' },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
)

badgeCriteriaSchema.index({ badgeDefinitionId: 1 })
badgeCriteriaSchema.index({ type: 1 })
badgeCriteriaSchema.index({ attributeCategoryId: 1 })
badgeCriteriaSchema.index({ subjectId: 1 })

export const BadgeCriteria = model<IBadgeCriteria>(
  'BadgeCriteria',
  badgeCriteriaSchema
)
