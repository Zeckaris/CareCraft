import { Document, Types } from 'mongoose'
import type { SoftWeights } from '../utils/scheduleSolver.util.js'
import type { ScheduleSettingData } from '../utils/scheduleSetting.util.js'

export type ScheduleStatus = 'draft' | 'published' | 'archived'

export interface ScheduleUnplacedLesson {
  lessonId: string
  sectionId: string
  gradeId: string
  subjectId: string
  teacherId: string
  periods: number
  reason: string
  reasons: Record<string, number>
}

export interface ScheduleStats {
  seed: number
  restarts: number
  iterations: number
  elapsedMs: number
  timedOut: boolean
  hardViolations: number
  softScore: number
  softBreakdown: SoftWeights
  unplacedCount: number
}

export interface ISchedule extends Document {
  _id: Types.ObjectId
  schoolYear: string // canonical YYYY-YYYY
  status: ScheduleStatus
  /** Fingerprint of the settings/requirements/assignments used to generate. */
  fingerprint: string
  /**
   * Frozen copy of the schedule-setting document used at generation time.
   * Period start/end times for reads are derived from this, so a schedule keeps
   * showing the times it was built with even if the year's settings later change.
   */
  settingsSnapshot: ScheduleSettingData | null
  entryCount: number
  stats: ScheduleStats
  unplaced: ScheduleUnplacedLesson[]
  /** Optimistic-concurrency counter for draft edits. */
  version: number
  publishedAt: Date | null
  publishedBy: Types.ObjectId | null
  /** Recorded when the schedule is published while lessons remain unplaced. */
  allowUnplacedOverride: boolean
  /** Source schedule when this draft was created by cloning. */
  clonedFrom: Types.ObjectId | null
  generatedBy: Types.ObjectId
  generatedAt: Date
  createdAt: Date
  updatedAt: Date
}
