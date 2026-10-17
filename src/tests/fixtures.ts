import type { DoublePeriodOption, ScheduleDay } from '../utils/scheduleSetting.util.js'
import type {
  ScheduleEntry,
  ValidationLesson,
  ValidationSettings,
  DayDerivedInput,
} from '../utils/scheduleValidator.util.js'

export const DAYS: ScheduleDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

export interface SettingsOpts {
  enabledDays?: ScheduleDay[]
  periodsPerDay?: number
  groups?: number[]
  dailyTeachingCap?: number
  minimumFreePeriodsPerDay?: number
  maximumWeeklyTaughtPeriods?: number | null
  maximumConsecutivePeriods?: number | null
  perDay?: DayDerivedInput[]
}

export function makeSettings(opts: SettingsOpts = {}): ValidationSettings {
  const enabledDays = opts.enabledDays ?? DAYS
  const periodsPerDay = opts.periodsPerDay ?? 5
  const groups = opts.groups ?? [periodsPerDay]
  const dailyTeachingCap = opts.dailyTeachingCap ?? periodsPerDay
  const perDay: DayDerivedInput[] =
    opts.perDay ?? enabledDays.map((day) => ({ day, periodsPerDay, groups, dailyTeachingCap }))
  return {
    enabledDays,
    perDay,
    minimumFreePeriodsPerDay: opts.minimumFreePeriodsPerDay ?? 0,
    maximumWeeklyTaughtPeriods: opts.maximumWeeklyTaughtPeriods ?? null,
    maximumConsecutivePeriods: opts.maximumConsecutivePeriods ?? null,
  }
}

export function lesson(
  sectionId: string,
  subjectId: string,
  teacherId: string,
  periodsPerWeek: number,
  doublePeriod: DoublePeriodOption = 'none',
  gradeId = 'G1'
): ValidationLesson {
  return {
    lessonId: `${sectionId}::${subjectId}`,
    sectionId,
    gradeId,
    subjectId,
    teacherId,
    teachingAssignmentId: `TA-${sectionId}-${subjectId}`,
    periodsPerWeek,
    doublePeriod,
  }
}

export function entry(
  sectionId: string,
  subjectId: string,
  teacherId: string,
  day: ScheduleDay,
  period: number,
  doubleGroupId: string | null = null,
  gradeId = 'G1'
): ScheduleEntry {
  return {
    sectionId,
    gradeId,
    day,
    period,
    subjectId,
    teacherId,
    teachingAssignmentId: `TA-${sectionId}-${subjectId}`,
    doubleGroupId,
  }
}
