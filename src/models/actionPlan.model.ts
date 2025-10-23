import { Schema, model, Types } from 'mongoose'
import { IActionPlan } from '../types/actionPlan.type'

const actionPlanSchema = new Schema<IActionPlan>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    issue: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
    goal: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
    actionSteps: [{
      step: { type: String, required: true, trim: true, minlength: 5, maxlength: 500 },
      completed: { type: Boolean, default: false }
    }],
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
)

actionPlanSchema.virtual('progressRating').get(function () {
  if (!this.actionSteps || this.actionSteps.length === 0) return 0;
  const completedSteps = this.actionSteps.filter((step: { completed: boolean }) => step.completed).length;
  return (completedSteps / this.actionSteps.length) * 100;
});

export const ActionPlan = model<IActionPlan>('ActionPlan', actionPlanSchema)
