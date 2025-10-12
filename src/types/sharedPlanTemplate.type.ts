import { Document, Types } from 'mongoose'

export interface IActionStep {
  stepNumber: number
  description: string
  role: 'teacher' | 'parent'
}

export interface ISharedPlanTemplate extends Document {
  _id: Types.ObjectId
  categoryId: Types.ObjectId
  actionSteps: IActionStep[]
  createdBy: Types.ObjectId
  createdAt: Date
}
