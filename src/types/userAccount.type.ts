import { Document } from 'mongoose'

export interface IUserAccount extends Document {
  _id: string
  firstName: string
  lastName: string
  email: string
  password: string
  role: 'student' | 'teacher' | 'parent' | 'admin' | 'coordinator'
  phoneNumber?: string
  createdAt: Date
  lastLogin?: Date
}
