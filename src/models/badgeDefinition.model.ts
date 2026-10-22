import { Schema, model } from 'mongoose'
import { IBadgeDefinition } from '../types/badgeDefinition.type.js'

const badgeDefinitionSchema = new Schema<IBadgeDefinition>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    howToEarn: { type: String, trim: true, default: '', maxlength: 500 },
    icon: { type: String, default: '' },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'UserAccount',
      required: true,
    },
    level: { type: Number, required: true, default: 1, min: 1 },
    /**
     * Empty means no grade is eligible yet; the badge cannot be awarded until
     * an admin explicitly lists the grades it applies to.
     */
    eligibleGrades: [
      { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    ],
    autoAward: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
)

// Badge names are unique per level. The controller returns a friendly error;
// this index is the final guard against concurrent creates.
badgeDefinitionSchema.index(
  { name: 1, level: 1 },
  { unique: true, name: 'badge_name_level_unique' }
)

// Criteria are owned by BadgeCriteria (single source of truth).
badgeDefinitionSchema.virtual('criteria', {
  ref: 'BadgeCriteria',
  localField: '_id',
  foreignField: 'badgeDefinitionId',
})

export const BadgeDefinition = model<IBadgeDefinition>(
  'BadgeDefinition',
  badgeDefinitionSchema
)
