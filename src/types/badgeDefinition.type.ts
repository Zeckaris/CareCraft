import { Document, Types } from 'mongoose'

export interface IBadgeDefinition extends Document {
  _id: Types.ObjectId
  name: string
  description: string
  icon?: string
  level : number
  criteria: Types.ObjectId[]
  createdBy: Types.ObjectId
  createdAt: Date
}
