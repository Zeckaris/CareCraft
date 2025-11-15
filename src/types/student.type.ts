import { Document, Types } from 'mongoose'

export interface IStudent extends Document {
  _id: Types.ObjectId
  firstName: string
  middleName?: string
  lastName: string
  gender: 'M' | 'F'
  dateOfBirth: Date
  enrollmentId: Types.ObjectId | null
  parentId: Types.ObjectId | null
  admissionDate: Date
  profileImage?: string
  createdAt: Date
}
