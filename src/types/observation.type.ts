import { Document, Types } from 'mongoose'

export interface IObservation extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  date: Date
  subjectId?: Types.ObjectId | null
  description: string
  schoolYear: string
  term: Types.ObjectId
  createdAt: Date
  updatedAt: Date
}
