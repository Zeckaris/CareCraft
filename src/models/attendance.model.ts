import { Schema, model } from 'mongoose'
import { IAttendance } from '../types/attendance.type.js'

const attendanceSchema = new Schema<IAttendance>(
  {
    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'StudentEnrollment',
      required: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    sectionId: {
      type: Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
    },
    // Stored as a YYYY-MM-DD string so Africa/Addis_Ababa midnight
    // never drifts to the previous UTC date.
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'],
    },
    status: {
      type: String,
      enum: ['present', 'absent', 'late', 'excused'],
      required: true,
    },
    note: { type: String, trim: true, default: '' },
    markedBy: {
      type: Schema.Types.ObjectId,
      ref: 'UserAccount',
      required: true,
    },
    schoolYear: { type: String, required: true, trim: true },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

// One record per enrollment per school day – the primary constraint.
attendanceSchema.index({ enrollmentId: 1, date: 1 }, { unique: true })

// Fast roster-for-a-date queries: section + date.
attendanceSchema.index({ sectionId: 1, date: 1 })

// Student date-range reports.
attendanceSchema.index({ studentId: 1, date: 1 })

// Section + year summary queries.
attendanceSchema.index({ sectionId: 1, schoolYear: 1 })

// Student + year summary queries.
attendanceSchema.index({ studentId: 1, schoolYear: 1 })

export const Attendance = model<IAttendance>('Attendance', attendanceSchema)
