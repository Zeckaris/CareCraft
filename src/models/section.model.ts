import { Schema, model } from 'mongoose'
import { ISection } from '../types/section.type.js'

const sectionSchema = new Schema<ISection>(
  {
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    schoolYear: {
      type: String,
      required: true,
      trim: true,
    },
    name: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

// Unique section name per grade + year (case-insensitive enforced by uppercase: true above)
sectionSchema.index({ gradeId: 1, schoolYear: 1, name: 1 }, { unique: true })

export const Section = model<ISection>('Section', sectionSchema)
