import { Document, Types } from 'mongoose'

export type StudentBadgeSource = 'teacher' | 'admin' | 'system'

export interface IStudentBadge extends Document {
  _id: Types.ObjectId
  badgeId: Types.ObjectId
  studentId: Types.ObjectId
  /** Canonical YYYY-YYYY school year derived from the current calendar. */
  schoolYear: string
  /** Term in which the badge was awarded. Unique per student + badge + term. */
  academicTermId: Types.ObjectId
  source: StudentBadgeSource
  /** Null only for future system awards. */
  awardedBy?: Types.ObjectId | null
  note?: string
  createdAt: Date
}
