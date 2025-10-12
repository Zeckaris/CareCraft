import { Document, Types } from 'mongoose'

export interface IAssessmentType extends Document {
  _id: Types.ObjectId
  name: string
  weight: number
  description?: string | null
  createdAt: Date
  updatedAt: Date
}
