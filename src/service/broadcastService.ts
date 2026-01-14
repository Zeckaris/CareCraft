import { BroadcastMessage } from '../models/broadcastMessage.model';
import { Notification } from '../models/notification.model';
import UserAccount from '../models/userAccount.model';
import { Types } from 'mongoose';

export interface IBroadcastJobData {
  broadcastId: string;
}

/**
 * Process a broadcast job: fetch broadcast, create notifications for users.
 * Skips any errors with individual users for now.
 */
export const processBroadcastJob = async (broadcastId: string): Promise<void> => {
  if (!Types.ObjectId.isValid(broadcastId)) {
    console.error('Invalid broadcastId:', broadcastId);
    return;
  }

  const broadcast = await BroadcastMessage.findById(broadcastId);
  if (!broadcast) {
    console.error('Broadcast not found for id:', broadcastId);
    return;
  }

  // Only process if broadcast is sent
  if (broadcast.status !== 'sent') {
    console.log('Broadcast is not marked as sent. Skipping.');
    return;
  }

  // Determine recipients
  let usersQuery = {};
  if (broadcast.recipients.includes('all')) {  // lowercase matches schema
    usersQuery = {}; // all users
  } else {
    usersQuery = { role: { $in: broadcast.recipients } };
  }

  const users = await UserAccount.find(usersQuery);

  if (users.length === 0) {
    console.log('ℹ No users matched broadcast recipients. Skipping.');
    return;
  }

  // Create notifications
  const notifications = users.map(u => ({
    userId: u._id,
    type: 'broadcast',
    title: broadcast.title,
    message: broadcast.body,
    broadcastId: broadcast._id,
    isRead: false,
  }));

  try {
    await Notification.insertMany(notifications);
    console.log(`Notifications created for broadcast: ${broadcastId}`);
  } catch (err) {
    console.error('Error creating some notifications, skipping:', err);
  }

  // Update sentAt timestamp if not already set
  if (!broadcast.sentAt) {
    broadcast.sentAt = new Date();
    await broadcast.save();
  }
};
