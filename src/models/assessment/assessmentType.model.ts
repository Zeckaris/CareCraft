import { Schema, model, Types } from 'mongoose'
import { IAssessmentType } from '../../types/assessment/assessmentType.type'

const assessmentTypeSchema = new Schema<IAssessmentType>(
  {
    name: { type: String, required: true, trim: true },
    weight: { type: Number, required: true },
    description: { type: String, default: null }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
)

export const AssessmentType = model<IAssessmentType>(
  'AssessmentType',
  assessmentTypeSchema
)
