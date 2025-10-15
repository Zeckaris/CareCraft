import { Schema, model } from 'mongoose'
import { IUserAccount } from '../types/userAccount.type'

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
},
{
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  })

export default model<IUserAccount>('UserAccount', userAccountSchema)
