import { Schema, model, Types } from 'mongoose'
import { IStudentBadge } from '../types/studentBadge.type'

const studentBadgeSchema = new Schema<IStudentBadge>(
  {
    badgeIds: [{ type: Schema.Types.ObjectId, ref: 'BadgeDefinition', required: true }],
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const StudentBadge = model<IStudentBadge>('StudentBadge', studentBadgeSchema)
