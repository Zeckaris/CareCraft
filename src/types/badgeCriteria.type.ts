import { Document, Types } from 'mongoose'
import type {
  BadgeCriteriaScope,
  BadgeCriteriaType,
  BadgeStreakMode,
} from '../badges/criteriaRegistry.js'

export interface IBadgeCriteria extends Document {
  _id: Types.ObjectId
  badgeDefinitionId: Types.ObjectId
  type: BadgeCriteriaType
  /** Only for attributeAverage. Null means "all attribute categories". */
  attributeCategoryId?: Types.ObjectId | null
  /** Only for attributeAverage. Validated against the category score scale. */
  minScore?: number | null
  /** Only for attendanceRate, academicAverage and academicConsistency. */
  minPercentage?: number | null
  /** Attendance-only minimum sample: recorded school days in the window. */
  minRecordedSchoolDays?: number | null
  /**
   * Legacy field from phase 1. No longer supplied or evaluated; kept so old
   * documents can still be read until the revision migration clears it.
   */
  minLockedWeightPercentage?: number | null
  /** Attribute-average-only minimum sample: number of evaluations in the window. */
  minEvaluationCount?: number | null
  /** Only for academicAverage. Null means the overall average. */
  subjectId?: Types.ObjectId | null
  /** Only for attendanceStreak. */
  mode?: BadgeStreakMode | null
  /** Only for attendanceStreak. Minimum longest streak, in recorded school days. */
  minDays?: number | null
  /** Only for academicImprovement. Positive percentage points. */
  minPoints?: number | null
  scope?: BadgeCriteriaScope | null
  description?: string
  createdAt?: Date
}
