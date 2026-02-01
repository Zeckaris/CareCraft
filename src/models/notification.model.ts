import { Schema, model, Types } from 'mongoose'
import { INotification } from '../types/notification.type.js'

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    type: { type: String, required: true, trim: true },
     title: { type: String, trim: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    broadcastId: { type: Schema.Types.ObjectId, ref: 'BroadcastMessage', default: null }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const Notification = model<INotification>('Notification', notificationSchema)
