import { Document, Types } from 'mongoose'

export interface IBadgeDefinition extends Document {
  _id: Types.ObjectId
  name: string
  description: string
  /** Optional teacher-facing explanation of how the badge is earned. */
  howToEarn: string
  icon?: string
  level: number
  /**
   * Grades the badge applies to. Empty means no grade is eligible yet, so the
   * badge cannot be awarded until an admin lists at least one grade.
   */
  eligibleGrades: Types.ObjectId[]
  /** Reserved for the phase-2 background evaluator. */
  autoAward: boolean
  /** Optional gift awarded together with the badge. */
  giftId?: Types.ObjectId | null
  /** Required when giftId is set; whole number from 1 to 100. */
  giftQuantity?: number | null
  createdBy: Types.ObjectId
  createdAt: Date
  /** Virtual-populated from BadgeCriteria.badgeDefinitionId. */
  criteria?: any[]
}
