import { Document, Types } from 'mongoose'

export interface INotification extends Document {
  _id: Types.ObjectId
  userId: Types.ObjectId
  title?: string;
  type: string
  message: string
  isRead: boolean
  broadcastId?: Types.ObjectId | null; 
  createdAt: Date
}
