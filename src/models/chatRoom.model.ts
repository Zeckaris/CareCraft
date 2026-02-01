import { Schema, model, Types } from 'mongoose'
import { IChatRoom } from '../types/chatRoom.type.js'

const chatRoomSchema = new Schema<IChatRoom>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'UserAccount', default: null }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const ChatRoom = model<IChatRoom>('ChatRoom', chatRoomSchema)
