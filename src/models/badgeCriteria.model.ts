import { Schema, model } from 'mongoose'
import { IBadgeCriteria } from '../types/badgeCriteria.type.js'
import {
  BADGE_CRITERIA_SCOPES,
  BADGE_CRITERIA_TYPES,
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
    /** academicAverage: percentage of total assessment weight that must be locked. */
    minLockedWeightPercentage: { type: Number, default: null },
    /** attributeAverage: evaluations required before evaluation. */
    minEvaluationCount: { type: Number, default: null },
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

export const BadgeCriteria = model<IBadgeCriteria>(
  'BadgeCriteria',
  badgeCriteriaSchema
)
