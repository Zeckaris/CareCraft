import { Schema, model, Types } from 'mongoose'
import { IActionPlan } from '../types/actionPlan.type'

const actionPlanSchema = new Schema<IActionPlan>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    issue: { type: String, required: true, trim: true },
    goal: { type: String, required: true, trim: true },
    actionSteps: { type: String, required: true },
    progressRating: { type: Number, required: true, min: 0, max: 100 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const ActionPlan = model<IActionPlan>('ActionPlan', actionPlanSchema)
