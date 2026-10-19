import { Document, Types } from 'mongoose'

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused'

export interface IAttendance extends Document {
  _id: Types.ObjectId

  /** The enrollment record active at the time this record was created.
   *  Survives mid-year section moves because we also snapshot sectionId. */
  enrollmentId: Types.ObjectId

  /** Denormalised for fast queries and for use after enrollment deactivation. */
  studentId: Types.ObjectId

  /** The section the student was in *on this date*.
   *  Preserved so that a mid-year move does not corrupt history. */
  sectionId: Types.ObjectId

  /** Calendar date stored as a plain YYYY-MM-DD string to avoid
   *  timezone off-by-one issues (Africa/Addis_Ababa is UTC+3). */
  date: string

  status: AttendanceStatus

  /** Optional free-text note (e.g. "Doctor's appointment"). */
  note?: string

  /** The user who last wrote this record. */
  markedBy: Types.ObjectId

  /** Denormalised school year (same format as enrollment.schoolYear). */
  schoolYear: string

  /** Term whose dates contain `date`. Optional for legacy rows. */
  academicTermId?: Types.ObjectId | null

  createdAt: Date
  updatedAt: Date
}
