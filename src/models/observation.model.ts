import { Schema, model, Types } from 'mongoose'
import { IObservation } from '../types/observation.type'

const observationSchema = new Schema<IObservation>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    date: { type: Date, required: true },
    category: { type: Schema.Types.ObjectId, ref: 'AttributeCategory', required: true },
    score: { type: Number, required: true },
    description: { type: String, required: true }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const Observation = model<IObservation>('Observation', observationSchema)
