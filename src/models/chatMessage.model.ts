import { Schema, model, Types } from 'mongoose'
import { IChatMessage } from '../types/chatMessage.type.js'

const chatMessageSchema = new Schema<IChatMessage>(
  {
    chatRoomId: { type: Schema.Types.ObjectId, ref: 'ChatRoom', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    message: { type: String, required: true },
    replyTo: { type: Schema.Types.ObjectId, ref: 'ChatMessage', default: null }
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } }
)

