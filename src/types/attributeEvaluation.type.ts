import { Document, Types } from 'mongoose'

export interface IAttributeItem {
  attributeId: Types.ObjectId
  score: number
  comment?: string
}

export interface IAttributeEvaluation extends Document {
  _id: Types.ObjectId
  studentId: Types.ObjectId
  teacherId: Types.ObjectId
  attributes: IAttributeItem[]
  totalScore: number
  remark?: string
  createdAt: Date
}
