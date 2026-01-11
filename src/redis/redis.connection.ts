import { ConnectionOptions } from 'bullmq';

export const redisConnection: ConnectionOptions = {
  host: '127.0.0.1',
  port: 6379,
  maxRetriesPerRequest: null, // REQUIRED by BullMQ
};
