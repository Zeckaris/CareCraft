import { Schema, model } from 'mongoose'
import { IBadgeAwardSuppression } from '../types/badgeAwardSuppression.type.js'

const badgeAwardSuppressionSchema = new Schema<IBadgeAwardSuppression>(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    badgeId: {
      type: Schema.Types.ObjectId,
      ref: 'BadgeDefinition',
      required: true,
    },
    academicTermId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicTerm',
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'UserAccount',
      required: true,
    },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
)

badgeAwardSuppressionSchema.index(
  { studentId: 1, badgeId: 1, academicTermId: 1 },
  { unique: true, name: 'badge_award_suppression_unique' }
)

export const BadgeAwardSuppression = model<IBadgeAwardSuppression>(
  'BadgeAwardSuppression',
  badgeAwardSuppressionSchema
)
