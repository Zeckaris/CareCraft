import { Document, Types } from 'mongoose'

export interface IChatMessage extends Document {
  _id: Types.ObjectId
  chatRoomId: Types.ObjectId
  senderId: Types.ObjectId
  message: string
  replyTo?: Types.ObjectId | null
  createdAt: Date
}
