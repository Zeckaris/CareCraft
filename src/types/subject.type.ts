import { Document, Types } from 'mongoose'

export interface ISubject extends Document {
  _id: Types.ObjectId
  name: string
  description?: string | null
  createdAt: Date
  updatedAt: Date
}
