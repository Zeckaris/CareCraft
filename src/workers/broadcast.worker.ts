import { createWorker } from './baseWorker.js';
import { processBroadcastJob } from '../service/broadcastService.js';
import { IBroadcastJobData } from '../types/broadcastJob.type.js';




export const broadcastWorker = createWorker<IBroadcastJobData>(
  'broadcast-queue',
  async (job) => {
    console.log(`Processing broadcast job ${job.id}`);
    await processBroadcastJob(job.data.broadcastId); 
  }
);
