import { Schema, model, Types } from 'mongoose'
import { IAttributeCategory } from '../types/attributeCategory.type.ts'

const attributeCategorySchema = new Schema<IAttributeCategory>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    minScore: { type: Number, required: true, default: 1 },
    maxScore: { type: Number, required: true, default: 5 }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
)

export const AttributeCategory = model<IAttributeCategory>('AttributeCategory', attributeCategorySchema)
