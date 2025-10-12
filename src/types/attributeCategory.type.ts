import { Document, Types } from 'mongoose'

export interface IAttributeCategory extends Document {
  _id: Types.ObjectId
  name: string
  description: string
  minScore: number
  maxScore: number
  createdAt: Date
  updatedAt: Date
}
