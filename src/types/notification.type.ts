import { Document, Types } from 'mongoose'

export interface INotification extends Document {
  _id: Types.ObjectId
  userId: Types.ObjectId
  type: string
  message: string
  isRead: boolean
  createdAt: Date
}
