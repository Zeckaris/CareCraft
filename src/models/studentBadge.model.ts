import { Schema, model, Types } from 'mongoose'
import { IStudentBadge } from '../types/studentBadge.type.js'

const studentBadgeSchema = new Schema<IStudentBadge>(
  {
    badgeId: { type: Schema.Types.ObjectId, ref: 'BadgeDefinition', required: true },
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    criteriaMet: { type: Boolean, default: false }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const StudentBadge = model<IStudentBadge>('StudentBadge', studentBadgeSchema)
