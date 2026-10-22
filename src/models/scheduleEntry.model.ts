import { Schema, model } from 'mongoose'
import { IScheduleEntry } from '../types/scheduleEntry.type.js'
import { ALL_SCHEDULE_DAYS } from '../utils/scheduleSetting.util.js'

const scheduleEntrySchema = new Schema<IScheduleEntry>(
  {
    scheduleId: { type: Schema.Types.ObjectId, ref: 'Schedule', required: true },
    schoolYear: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    teachingAssignmentId: { type: Schema.Types.ObjectId, ref: 'TeachingAssignment', required: true },
    day: { type: String, enum: ALL_SCHEDULE_DAYS, required: true },
    period: { type: Number, required: true, min: 1 },
    doubleGroupId: { type: String, default: null },
    locked: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

// One lesson per section slot per schedule.
scheduleEntrySchema.index(
  { scheduleId: 1, sectionId: 1, day: 1, period: 1 },
  { unique: true }
)

// A teacher cannot be double-booked within a schedule.
scheduleEntrySchema.index(
  { scheduleId: 1, teacherId: 1, day: 1, period: 1 },
  { unique: true }
)

// Reading a whole schedule, and per-section/per-teacher views.
scheduleEntrySchema.index({ scheduleId: 1 })
scheduleEntrySchema.index({ scheduleId: 1, sectionId: 1 })
scheduleEntrySchema.index({ scheduleId: 1, teacherId: 1 })

// Bulk lock/unlock by filter.
scheduleEntrySchema.index({ scheduleId: 1, gradeId: 1 })
scheduleEntrySchema.index({ scheduleId: 1, day: 1 })
scheduleEntrySchema.index({ scheduleId: 1, locked: 1 })

export const ScheduleEntry = model<IScheduleEntry>('ScheduleEntry', scheduleEntrySchema)
