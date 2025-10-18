import { Document, Types } from 'mongoose'

export interface IAssessmentSetup extends Document {
  _id: Types.ObjectId
  name: string
  description?: string | null
  assessmentTypeIds: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}
