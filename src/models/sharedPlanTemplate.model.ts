import { Schema, model, Types } from 'mongoose'
import { ISharedPlanTemplate, IActionStep } from '../types/sharedPlanTemplate.type'

const actionStepSchema = new Schema<IActionStep>(
  {
    stepNumber: { type: Number, required: true },
    description: { type: String, required: true },
    role: { type: String, enum: ['teacher', 'parent'], required: true }
  },
  { _id: false }
)

const sharedPlanTemplateSchema = new Schema<ISharedPlanTemplate>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'AttributeCategory', required: true },
    actionSteps: { type: [actionStepSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const SharedPlanTemplate = model<ISharedPlanTemplate>(
  'SharedPlanTemplate',
  sharedPlanTemplateSchema
)
