import { Document, Types } from 'mongoose'

export interface IObservation extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  date: Date
  category: Types.ObjectId
  score : number;
  description: string
  createdAt: Date
}
