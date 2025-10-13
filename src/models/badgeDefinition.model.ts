import { Schema, model, Types } from 'mongoose'
import { IBadgeDefinition } from '../types/badgeDefinition.type'

const badgeDefinitionSchema = new Schema<IBadgeDefinition>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    icon: { type: String, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const BadgeDefinition = model<IBadgeDefinition>('BadgeDefinition', badgeDefinitionSchema)
