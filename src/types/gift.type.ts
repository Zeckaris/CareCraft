import { Document, Types } from 'mongoose'

export interface IGift extends Document {
  _id: Types.ObjectId
  name: string
  description?: string
  image?: string
  isActive: boolean
  createdBy: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}
