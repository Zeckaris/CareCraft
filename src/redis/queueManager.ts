import { Queue } from 'bullmq';
import { redisConnection } from './redis.connection.js';
import { IBroadcastJobData } from '../types/broadcastJob.type.js';
import { IAbsenceNotificationJobData } from '../types/absenceNotificationJob.type.js';
import { BadgeEvaluationJobData } from '../types/badgeEvaluationJob.type.js';

/**
 * Central queue manager for all jobs.
 * Each queue is created here and exported.
 */
export const queues = {
  broadcast: new Queue<IBroadcastJobData>('broadcast-queue', { connection: redisConnection }),
  absenceNotification: new Queue<IAbsenceNotificationJobData>(
    'absence-notification-queue',
    { connection: redisConnection }
  ),
  badgeEvaluation: new Queue<BadgeEvaluationJobData>(
    'badge-evaluation-queue',
    { connection: redisConnection }
  ),
};
