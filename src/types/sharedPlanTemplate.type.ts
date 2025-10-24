import { Document, Types } from 'mongoose'

export interface IActionStep {
  stepNumber: number
  description: string
}

export interface ISharedPlanTemplate extends Document {
  _id: Types.ObjectId
  title: string;
  categoryId: Types.ObjectId
  actionSteps: IActionStep[]
  createdBy: Types.ObjectId
  usageCount: number;
  rating: number;
  ratingCount: number;
  ratedBy: Types.ObjectId[]
  createdAt: Date;
}
