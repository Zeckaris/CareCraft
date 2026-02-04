import { Document, Types } from 'mongoose'

export interface IUserAccount extends Document {
  _id: Types.ObjectId
  firstName: string
  lastName: string
  email: string
  password: string
  role: 'student' | 'teacher' | 'parent' | 'admin' | 'coordinator'
  phoneNumber?: string
  createdAt: Date
  updatedAt: Date
  lastLogin?: Date

  // === MFA Feature ===
  mfaEnabled: boolean

  // === Account Suspension Feature ===
isSuspended: boolean
  suspendedAt?: Date | null
  suspendedBy?: string | null
  suspensionReason?: string | null
}