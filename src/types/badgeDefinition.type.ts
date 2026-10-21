import { Document, Types } from 'mongoose'

export interface IBadgeDefinition extends Document {
  _id: Types.ObjectId
  name: string
  description: string
  icon?: string
  level: number
  /**
   * Grades the badge applies to. Empty means no grade is eligible yet, so the
   * badge cannot be awarded until an admin lists at least one grade.
   */
  eligibleGrades: Types.ObjectId[]
  /** Reserved for the phase-2 background evaluator. */
  autoAward: boolean
  createdBy: Types.ObjectId
  createdAt: Date
  /** Virtual-populated from BadgeCriteria.badgeDefinitionId. */
  criteria?: any[]
}
