import { AuditLog } from '../models/auditLog.model'; 
import { Request } from 'express';

interface LogOptions {
  type: string;
  message?: string;       // optional now
  action?: string;
  entity?: string;
  target?: string;
}

export const logAudit = async (
  req: Request,
  options: LogOptions
): Promise<void> => {
  const user = (req as any).user;
  if (!user?.id) {
    console.warn('Audit log skipped: No user in request');
    return;
  }

  // Build message if not provided
  const message =
    options.message ??
    `${user.firstName} ${options.action ?? ''} ${options.entity ?? ''}`.trim();

  if (!message) {
    console.warn('Audit log skipped: message is empty');
    return;
  }

  try {
    await AuditLog.create({
      type: options.type,
      message,
      actor: user.id,
      target: options.target ?? '',
    });
  } catch (error) {
    console.error('Failed to log audit:', error);
  }
};
