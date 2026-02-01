import { Schema, model, Types } from 'mongoose'
import { IFlaggedIssue } from '../types/flaggedIssue.type.js'

const flaggedIssueSchema = new Schema<IFlaggedIssue>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    issueType: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    linkedAttribute: { type: Schema.Types.ObjectId, ref: 'AttributeCategory', default: null }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const FlaggedIssue = model<IFlaggedIssue>('FlaggedIssue', flaggedIssueSchema)
