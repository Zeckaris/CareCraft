import { ConnectionOptions } from 'bullmq';

if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
  throw new Error('Missing Redis environment variables');
}

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT),
  password: process.env.REDIS_PASSWORD || undefined, // optional
  maxRetriesPerRequest: null, // REQUIRED by BullMQ
};
