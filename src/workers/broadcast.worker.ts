import { createWorker } from './baseWorker';
import { processBroadcastJob } from '../service/broadcastService';
import { IBroadcastJobData } from '../types/broadcastJob.type';




export const broadcastWorker = createWorker<IBroadcastJobData>(
  'broadcast-queue',
  async (job) => {
    console.log(`Processing broadcast job ${job.id}`);
    await processBroadcastJob(job.data.broadcastId); 
  }
);
