import { Document, Types } from 'mongoose'

export interface IInviteToken extends Document {
  _id: Types.ObjectId
  token: string
  role: 'Teacher' | 'Parent'
  createdFor?: Types.ObjectId | null
  expiresAt: Date
  isUsed: boolean
  createdAt: Date
}
