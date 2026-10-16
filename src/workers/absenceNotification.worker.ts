import { createWorker } from './baseWorker.js'
import { IAbsenceNotificationJobData } from '../types/absenceNotificationJob.type.js'
import { Notification } from '../models/notification.model.js'
import { Types } from 'mongoose'

/**
 * Worker that processes absence-notification jobs.
 *
 * The job data already contains the parentId and student name so the worker
 * does not need to re-fetch the attendance record; it just creates the
 * Notification document directly.
 */
export const absenceNotificationWorker = createWorker<IAbsenceNotificationJobData>(
  'absence-notification-queue',
  async (job) => {
    const { parentId, studentName, date } = job.data

    if (!Types.ObjectId.isValid(parentId)) {
      console.error(`[absenceNotificationWorker] Invalid parentId in job ${job.id}`)
      return
    }

    await Notification.create({
      userId: new Types.ObjectId(parentId),
      type: 'absence',
      title: 'Absence Alert',
      message: `${studentName} was marked absent on ${date}.`,
      isRead: false,
      priority: 'normal',
    })

    console.log(
      `[absenceNotificationWorker] Notification created for parent ${parentId} – student ${studentName} absent on ${date}`
    )
  }
)
