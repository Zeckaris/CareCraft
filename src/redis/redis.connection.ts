import { ConnectionOptions } from 'bullmq';


const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redisConnection: ConnectionOptions = {
  url: redisUrl,
  maxRetriesPerRequest: null,
};

if (process.env.NODE_ENV !== 'production') {
  console.log(`Using Redis connection URL: ${redisUrl}`);
}