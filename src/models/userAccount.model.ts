import { Schema, model } from 'mongoose'
import { IUserAccount } from '../types/userAccount.type.js'

const userAccountSchema = new Schema<IUserAccount>({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: {
    type: String,
    enum: ['student', 'teacher', 'parent', 'admin', 'coordinator'],
    required: true
  },
  phoneNumber: { type: String },
  lastLogin: { type: Date },

  mfaEnabled: {
    type: Boolean,
    default: false
  },

  // === Account Suspension Feature ===
  isSuspended: {
    type: Boolean,
    default: false
  },
  suspendedAt: {
    type: Date
  },
  suspendedBy: {
    type: Schema.Types.ObjectId,
    ref: 'UserAccount'
  },
  suspensionReason: {
    type: String
  }
},
{
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  })

// Index only for suspension queries 
userAccountSchema.index({ isSuspended: 1 });

export default model<IUserAccount>('UserAccount', userAccountSchema)