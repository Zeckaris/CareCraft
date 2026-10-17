import { Schema, model } from 'mongoose'
import { IScheduleSetting } from '../types/scheduleSetting.type.js'
import { ALL_SCHEDULE_DAYS, DEFAULT_ENABLED_DAYS } from '../utils/scheduleSetting.util.js'

const bellBlockSchema = new Schema(
  {
    type: { type: String, enum: ['period', 'break'], required: true },
    durationMinutes: { type: Number, required: true, min: 1 },
    label: { type: String, default: null },
  },
  { _id: false }
)

const bellScheduleSchema = new Schema(
  {
    startTime: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'startTime must be a valid 24-hour HH:mm time'],
    },
    blocks: { type: [bellBlockSchema], default: [] },
  },
  { _id: false }
)

const scheduleSettingSchema = new Schema<IScheduleSetting>(
  {
    schoolYear: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    enabledDays: {
      type: [String],
      enum: ALL_SCHEDULE_DAYS,
      default: DEFAULT_ENABLED_DAYS,
    },
    bellSchedule: { type: bellScheduleSchema, required: true },
    saturdayBellSchedule: { type: bellScheduleSchema, default: null },
    minimumFreePeriodsPerDay: { type: Number, default: 1, min: 0 },
    maximumWeeklyTaughtPeriods: { type: Number, default: null, min: 1 },
    maximumConsecutivePeriods: { type: Number, default: null, min: 1 },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

export const ScheduleSetting = model<IScheduleSetting>(
  'ScheduleSetting',
  scheduleSettingSchema
)
