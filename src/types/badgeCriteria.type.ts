import { Document, Types } from 'mongoose'
import type { BadgeCriteriaScope, BadgeCriteriaType } from '../badges/criteriaRegistry.js'

export interface IBadgeCriteria extends Document {
  _id: Types.ObjectId
  badgeDefinitionId: Types.ObjectId
  type: BadgeCriteriaType
  /** Only for attributeAverage. Null means "all attribute categories". */
  attributeCategoryId?: Types.ObjectId | null
  /** Only for attributeAverage. Validated against the category score scale. */
  minScore?: number | null
  /** Only for attendanceRate and academicAverage. */
  minPercentage?: number | null
  /** Attendance-only minimum sample: recorded school days in the window. */
  minRecordedSchoolDays?: number | null
  /** Academic-average-only minimum sample: share of total assessment weight locked in the window. */
  minLockedWeightPercentage?: number | null
  /** Attribute-average-only minimum sample: number of evaluations in the window. */
  minEvaluationCount?: number | null
  scope?: BadgeCriteriaScope | null
  description?: string
  createdAt?: Date
}
