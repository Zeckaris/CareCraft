import { Schema, model, Types } from 'mongoose';
import { IBroadcastMessage, BroadcastPriority } from '../types/broadcastMessage.type.js';

const broadcastMessageSchema = new Schema<IBroadcastMessage>(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true }, // rich text / markdown
    recipients: [{ 
      type: String, 
      enum: ['student', 'teacher', 'parent', 'admin', 'coordinator', 'all'],
      required: true 
    }],
    sentBy: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    sentAt: { type: Date, default: null },
    status: { type: String, enum: ['draft', 'sent'], default: 'draft' },
    priority: { type: String, enum: ['urgent', 'normal', 'low'], default: 'normal' },
    queueJobId: { type: String, default: null } // optional job reference
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
);

export const BroadcastMessage = model<IBroadcastMessage>('BroadcastMessage', broadcastMessageSchema);
