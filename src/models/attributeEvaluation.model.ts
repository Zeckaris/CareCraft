import { Schema, model, Types } from 'mongoose'
import { IAttributeEvaluation, IAttributeItem } from '../types/attributeEvaluation.type.js'

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
    studentEnrollmentId: { type: Schema.Types.ObjectId, ref: 'StudentEnrollment', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    attributes: { type: [attributeItemSchema], required: true },
    totalScore: { type: Number, required: true },
    remark: { type: String, default: '' }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

attributeEvaluationSchema.pre('save', function (next) {
  this.totalScore = this.attributes.reduce((acc, item) => acc + item.score, 0);
  next();
});

export const AttributeEvaluation = model<IAttributeEvaluation>(
  'AttributeEvaluation',
  attributeEvaluationSchema
)
