import { Worker, Job } from 'bullmq';
import { redisConnection } from '../redis/redis.connection';

/**
 * Generic worker setup.
 * Each specific worker will extend this pattern.
 */
export const createWorker = <T>(
  queueName: string,
  processor: (job: Job<T>) => Promise<void>,
  concurrency = 2
) => {
  const worker = new Worker(queueName, processor, { connection: redisConnection, concurrency });

  worker.on('completed', (job) => {
    console.log(`🎉 Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`❌ Job ${job?.id} failed`, err);
  });

  return worker;
};
