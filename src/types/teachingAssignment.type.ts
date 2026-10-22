import { Document, Types } from 'mongoose'

export type TeachingRole = 'homeroom' | 'subject'

export interface ITeachingAssignment extends Document {
  _id: Types.ObjectId
  sectionId: Types.ObjectId
  teacherId: Types.ObjectId       // ref: UserAccount (role === 'teacher')
  role: TeachingRole              // 'homeroom' | 'subject'
  subjectId?: Types.ObjectId      // required when role === 'subject', null for homeroom
  schoolYear: string              // denormalised from section for fast queries
  createdAt: Date
  updatedAt: Date
}
