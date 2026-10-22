import { Schema, model, Types } from 'mongoose';
import { IAuditLog } from '../types/auditLog.type.js';

const auditLogSchema = new Schema<IAuditLog>(
  {
    type: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    actor: { 
      type: Schema.Types.ObjectId, 
      ref: 'UserAccount', 
      required: true 
    },
    actorRole: { type: String, default: null }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false },
  }
);

auditLogSchema.index({ createdAt: -1 });

export const AuditLog = model<IAuditLog>('AuditLog', auditLogSchema);