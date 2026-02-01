import mongoose, { Types } from 'mongoose';
import { queues } from '../redis/queueManager.js';
import { BroadcastMessage } from '../models/broadcastMessage.model.js';
import { Notification } from '../models/notification.model.js';
import UserAccount from '../models/userAccount.model.js';
import { IUserAccount } from '../types/userAccount.type.js';

// -------------------- Configuration --------------------

// Connect to MongoDB (adjust URI if needed)
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/carecraft';

const recipients: IUserAccount['role'][] = [
  'admin',
  'teacher',
  'parent',
  'student',
  'coordinator',
];

async function main() {
  try {
    // 0️⃣ Connect to DB
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // 1️⃣ Pick a real user as sender
    const sender = await UserAccount.findOne(); // pick any existing user
    if (!sender) {
      console.error('❌ No user found in the database. Please create at least one user.');
      process.exit(1);
    }
    console.log(`🧑 Using user ${sender.email} as broadcast sender`);

    // 2️⃣ Create a broadcast message
    const broadcast = new BroadcastMessage({
      title: 'System Maintenance Notice',
      body: 'The system will be down for maintenance tonight from 12AM to 2AM.',
      recipients,
      status: 'sent', // triggers processing
      sentBy: sender._id,
    });

    await broadcast.save();
    console.log('✅ Broadcast message created with ID:', broadcast._id.toString());

    // 3️⃣ Add a job to the broadcast queue
    const jobData = { broadcastId: broadcast._id.toString() };
    const job = await queues.broadcast.add('broadcast-job', jobData);
    console.log('✅ Job added to queue with ID:', job.id);

    // 4️⃣ Wait a bit for the worker to process
    console.log('⏳ Waiting 3 seconds for worker to process...');
    setTimeout(async () => {
      // 5️⃣ Check notifications created
      const notifications = await Notification.find({ broadcastId: broadcast._id });
      console.log(`✅ Notifications created: ${notifications.length}`);

      // 6️⃣ Close queue and DB connection
      await queues.broadcast.close();
      await mongoose.disconnect();
      console.log('✅ Queue and DB connection closed');

      process.exit(0);
    }, 3000); // wait 3s to ensure processing
  } catch (error) {
    console.error('❌ Error in broadcast test flow:', error);
    process.exit(1);
  }
}

main();
