import { Document, Types } from 'mongoose'
import type { DoublePeriodOption } from '../utils/scheduleSetting.util.js'

export interface IWeeklyPeriodRequirement extends Document {
  _id: Types.ObjectId
  schoolYear: string // canonical YYYY-YYYY
  gradeId: Types.ObjectId
  subjectId: Types.ObjectId
  periodsPerWeek: number
  doublePeriod: DoublePeriodOption
  createdAt: Date
  updatedAt: Date
}
