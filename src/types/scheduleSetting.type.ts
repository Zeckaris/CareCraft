import { Document, Types } from 'mongoose'
import type { BellSchedule, ScheduleDay } from '../utils/scheduleSetting.util.js'

export interface IScheduleSetting extends Document {
  _id: Types.ObjectId
  schoolYear: string // canonical YYYY-YYYY
  enabledDays: ScheduleDay[]
  bellSchedule: BellSchedule
  saturdayBellSchedule?: BellSchedule | null
  minimumFreePeriodsPerDay: number
  maximumWeeklyTaughtPeriods?: number | null
  maximumConsecutivePeriods?: number | null
  createdAt: Date
  updatedAt: Date
}
