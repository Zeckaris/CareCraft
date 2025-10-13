import { Schema, model, Types } from 'mongoose'
import { IAttributeEvaluation, IAttributeItem } from '../types/attributeEvaluation.type'

const attributeItemSchema = new Schema<IAttributeItem>(
  {
    attributeId: { type: Schema.Types.ObjectId, ref: 'AttributeCategory', required: true },
    score: { type: Number, required: true },
    comment: { type: String, default: '' }
  },
  { _id: false }
)

const attributeEvaluationSchema = new Schema<IAttributeEvaluation>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    attributes: { type: [attributeItemSchema], required: true },
    totalScore: { type: Number, required: true },
    remark: { type: String, default: '' }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const AttributeEvaluation = model<IAttributeEvaluation>(
  'AttributeEvaluation',
  attributeEvaluationSchema
)
