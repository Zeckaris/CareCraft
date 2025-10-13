import { Schema, model, Types } from 'mongoose'
import { INotification } from '../types/notification.type'

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    type: { type: String, required: true, trim: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const Notification = model<INotification>('Notification', notificationSchema)
