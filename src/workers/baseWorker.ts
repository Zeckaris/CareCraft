import { Worker, Job } from 'bullmq';
import { redisConnection } from '../redis/redis.connection';

export const createWorker = <T>(
  queueName: string,
  processor: (job: Job<T>) => Promise<void>,
  concurrency = 2
) => {
  const worker = new Worker(queueName, processor, { connection: redisConnection, concurrency });

  worker.on('completed', (job) => {
  });

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed`, err);
  });

  return worker;
};
