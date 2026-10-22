import { Document, Types } from 'mongoose'
import type { ScheduleDay } from '../utils/scheduleSetting.util.js'

export interface IScheduleEntry extends Document {
  _id: Types.ObjectId
  scheduleId: Types.ObjectId
  schoolYear: string // canonical YYYY-YYYY (denormalised for queries)
  sectionId: Types.ObjectId
  gradeId: Types.ObjectId
  subjectId: Types.ObjectId
  teacherId: Types.ObjectId
  teachingAssignmentId: Types.ObjectId
  day: ScheduleDay
  period: number
  doubleGroupId: string | null
  locked: boolean
  createdAt: Date
  updatedAt: Date
}
