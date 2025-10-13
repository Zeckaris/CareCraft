import { Schema, model, Types } from 'mongoose'
import { IProgressUpdate } from '../types/progressUpdate.type'

const progressUpdateSchema = new Schema<IProgressUpdate>(
  {
    actionPlanId: { type: Schema.Types.ObjectId, ref: 'ActionPlan', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', default: null },
    parentId: { type: Schema.Types.ObjectId, ref: 'UserAccount', default: null },
    note: { type: String, required: true }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const ProgressUpdate = model<IProgressUpdate>('ProgressUpdate', progressUpdateSchema)
