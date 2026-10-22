import { Document, Types } from 'mongoose'
import { BroadcastPriority } from './broadcastMessage.type.js'

export interface INotification extends Document {
  _id: Types.ObjectId
  userId: Types.ObjectId
  title?: string;
  type: string
  message: string
  isRead: boolean
  priority: BroadcastPriority
  broadcastId?: Types.ObjectId | null
  studentId?: Types.ObjectId | null
  badgeId?: Types.ObjectId | null
  createdAt: Date
}
