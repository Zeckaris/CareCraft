import { Document, Types } from 'mongoose'

export interface IBadgeDefinition extends Document {
  _id: Types.ObjectId
  name: string
  description: string
  icon?: string
  createdBy: Types.ObjectId
  createdAt: Date
}
