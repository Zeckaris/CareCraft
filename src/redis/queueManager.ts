import { Queue } from 'bullmq';
import { redisConnection } from './redis.connection';
import { IBroadcastJobData } from '../types/broadcastJob.type';

/**
 * Central queue manager for all jobs.
 * Each queue is created here and exported.
 */
export const queues = {
  broadcast: new Queue<IBroadcastJobData>('broadcast-queue', { connection: redisConnection }),
  // future queues: studentEnrolment: new Queue<...>(...)
};
