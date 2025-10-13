import { Schema, model, Types } from 'mongoose'
import { IInviteToken } from '../types/inviteToken.type'

const inviteTokenSchema = new Schema<IInviteToken>(
  {
    token: { type: String, required: true, unique: true },
    role: { type: String, enum: ['Teacher', 'Parent'], required: true },
    createdFor: { type: Schema.Types.ObjectId, ref: 'UserAccount', default: null },
    expiresAt: { type: Date, required: true },
    isUsed: { type: Boolean, default: false }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const InviteToken = model<IInviteToken>('InviteToken', inviteTokenSchema)
