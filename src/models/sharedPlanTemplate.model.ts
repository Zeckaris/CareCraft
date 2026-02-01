import { Schema, model, Types } from 'mongoose'
import { ISharedPlanTemplate, IActionStep } from '../types/sharedPlanTemplate.type.js'

const actionStepSchema = new Schema<IActionStep>(
  {
    stepNumber: { type: Number, required: true },
    description: { type: String, required: true },
  },
  { _id: false }
)

const sharedPlanTemplateSchema = new Schema<ISharedPlanTemplate>(
  {
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 100 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'AttributeCategory', required: true },
    actionSteps: {
      type: [actionStepSchema],
      default: [],
      validate: [(v: IActionStep[]) => v.length > 0, 'At least one action step is required'],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    usageCount: { type: Number, default: 0, min: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    ratedBy: [{ type: Schema.Types.ObjectId, ref: 'UserAccount' }]
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const SharedPlanTemplate = model<ISharedPlanTemplate>(
  'SharedPlanTemplate',
  sharedPlanTemplateSchema
)
