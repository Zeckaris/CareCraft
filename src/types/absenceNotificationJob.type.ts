/** Job data sent to the absence-notification queue. */
export interface IAbsenceNotificationJobData {
  /** Attendance record id – worker fetches fresh data from DB. */
  attendanceId: string
  /** Student's parentId – pre-fetched so the worker can skip a lookup. */
  parentId: string
  /** Student name for the notification message. */
  studentName: string
  /** YYYY-MM-DD date string of the absence. */
  date: string
}
