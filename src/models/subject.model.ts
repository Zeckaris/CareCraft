import { Schema, model, Types } from 'mongoose'
import { ISubject } from '../types/subject.type.js'

const subjectSchema = new Schema<ISubject>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
)

export const Subject = model<ISubject>('Subject', subjectSchema)
