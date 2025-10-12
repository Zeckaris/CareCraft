import { Document, Types } from 'mongoose'

export interface IStudent extends Document {
  _id: Types.ObjectId
  firstName: string
  middleName?: string
  lastName: string
  gender: string
  dateOfBirth: Date
  enrollmentId: Types.ObjectId
  parentId: Types.ObjectId
  admissionDate: Date
  profileImage?: string
  createdAt: Date
}
