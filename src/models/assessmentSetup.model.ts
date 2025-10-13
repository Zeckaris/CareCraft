import { Schema, model, Types } from 'mongoose'
import { IAssessmentSetup } from '../types/assessmentSetup.type'

const assessmentSetupSchema = new Schema<IAssessmentSetup>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    assessmentTypeIds: [{ type: Schema.Types.ObjectId, ref: 'AssessmentType', required: true }]
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
)

export const AssessmentSetup = model<IAssessmentSetup>(
  'AssessmentSetup',
  assessmentSetupSchema
)
