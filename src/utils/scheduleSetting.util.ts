/**
 * scheduleSetting.util.ts
 *
 * Pure, dependency-free helpers for the school-wide schedule settings.
 *
 * Everything here works on plain data (no Mongoose models, no I/O) so it can be
 * reused by later phases (solver, manual edits, publishing) and exercised in
 * isolation.
 *
 * Concepts
 *  - A bell schedule is a start time plus an ordered list of blocks. A block is
 *    either a "period" or a "break" and carries a positive integer duration in
 *    minutes and an optional label.
 *  - Periods that sit between breaks form a "group"; the group sizes describe
 *    the shape of the day (e.g. [3, 2, 2] = three periods, break, two, break, two).
 *  - One weekday bell schedule is shared by every grade. Saturday may use its
 *    own schedule, falling back to the weekday schedule when omitted.
 */

export type ScheduleDay =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'

export const ALL_SCHEDULE_DAYS: ScheduleDay[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
]

export const DEFAULT_ENABLED_DAYS: ScheduleDay[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
]

export type BellBlockType = 'period' | 'break'

export interface BellBlock {
  type: BellBlockType
  durationMinutes: number
  label?: string | null
}

export interface BellSchedule {
  startTime: string
  blocks: BellBlock[]
}

export type DoublePeriodOption = 'none' | 'allowed' | 'required'

export const DOUBLE_PERIOD_OPTIONS: DoublePeriodOption[] = ['none', 'allowed', 'required']

/** Plain shape of a stored schedule setting (used by the pure helpers). */
export interface ScheduleSettingData {
  schoolYear: string
  enabledDays: ScheduleDay[]
  bellSchedule: BellSchedule
  saturdayBellSchedule?: BellSchedule | null
  minimumFreePeriodsPerDay: number
  maximumWeeklyTaughtPeriods?: number | null
  maximumConsecutivePeriods?: number | null
}

export interface BellPeriod {
  index: number
  start: string
  end: string
  startMinutes: number
  endMinutes: number
}

export interface BellTimeline {
  periods: BellPeriod[]
  periodCount: number
  finishTime: string
  finishMinutes: number
  /** Periods between breaks, e.g. [3, 2, 2]. Always sums to periodCount. */
  groups: number[]
  totalMinutes: number
}

export interface DayDerived {
  day: ScheduleDay
  source: 'weekday' | 'saturday'
  periodsPerDay: number
  startTime: string
  finishTime: string
  periods: BellPeriod[]
  groups: number[]
  dailyTeachingCap: number
}

export interface SaturdayDerived {
  enabled: boolean
  usedFallbackToWeekday: boolean
  periodsPerDay: number
  startTime: string
  finishTime: string
  periods: BellPeriod[]
  groups: number[]
}

export interface ScheduleSettingDerived {
  /** Weekday schedule summary. */
  periodsPerDay: number
  periods: BellPeriod[]
  finishTime: string
  groups: number[]
  /** Weekly slot count across every enabled day. */
  weeklySlotCount: number
  enabledDays: ScheduleDay[]
  enabledDayCount: number
  /** Weekday teaching cap = periodsPerDay - minimumFreePeriodsPerDay (never < 0). */
  dailyTeachingCap: number
  /** Per-enabled-day breakdown including each day's teaching cap. */
  perDay: DayDerived[]
  saturday: SaturdayDerived | null
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseTimeToMinutes(time: unknown): number | null {
  if (typeof time !== 'string' || !TIME_RE.test(time)) return null
  const [h, m] = time.split(':').map((n) => parseInt(n, 10))
  return h * 60 + m
}

export function formatMinutesToTime(total: number): string {
  const safe = ((Math.trunc(total) % 1440) + 1440) % 1440
  const h = Math.floor(safe / 60)
  const m = safe % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Walks the blocks from the start time and produces the start/end time of every
 * period, the finish time, and the period groups between breaks.
 * Assumes `schedule` has already been validated; malformed durations count as 0.
 */
export function buildBellTimeline(schedule: BellSchedule): BellTimeline {
  const startMinutes = parseTimeToMinutes(schedule?.startTime) ?? 0
  const blocks = Array.isArray(schedule?.blocks) ? schedule.blocks : []

  const periods: BellPeriod[] = []
  const groups: number[] = []
  let cursor = startMinutes
  let currentGroup = 0
  let periodIndex = 0
  let totalMinutes = 0

  for (const block of blocks) {
    const raw = Number(block?.durationMinutes)
    const duration = Number.isFinite(raw) && raw > 0 ? raw : 0

    if (block?.type === 'period') {
      periods.push({
        index: periodIndex++,
        start: formatMinutesToTime(cursor),
        end: formatMinutesToTime(cursor + duration),
        startMinutes: cursor,
        endMinutes: cursor + duration,
      })
      currentGroup += 1
    } else if (currentGroup > 0) {
      groups.push(currentGroup)
      currentGroup = 0
    }

    cursor += duration
    totalMinutes += duration
  }

  if (currentGroup > 0) groups.push(currentGroup)

  return {
    periods,
    periodCount: periods.length,
    finishTime: formatMinutesToTime(cursor),
    finishMinutes: cursor,
    groups,
    totalMinutes,
  }
}

export interface BellScheduleValidationOptions {
  minPeriods: number
  maxPeriods: number
  field: string
}

/**
 * Validates a single bell schedule. Returns a list of human-readable problems
 * (empty when valid): start time, block types/durations, no leading/trailing or
 * adjacent breaks, and the required count of period blocks.
 */
export function validateBellSchedule(
  schedule: unknown,
  opts: BellScheduleValidationOptions
): string[] {
  const { field, minPeriods, maxPeriods } = opts
  const errors: string[] = []

  if (!schedule || typeof schedule !== 'object') {
    return [`${field} is required`]
  }
  const s = schedule as Partial<BellSchedule>

  if (parseTimeToMinutes(s.startTime) === null) {
    errors.push(`${field}.startTime must be a valid 24-hour HH:mm time`)
  }
  if (!Array.isArray(s.blocks) || s.blocks.length === 0) {
    errors.push(`${field}.blocks must be a non-empty array`)
    return errors
  }

  const blocks = s.blocks as (BellBlock | undefined)[]
  let periodCount = 0

  blocks.forEach((block, i) => {
    if (!block || (block.type !== 'period' && block.type !== 'break')) {
      errors.push(`${field}.blocks[${i}].type must be "period" or "break"`)
    }
    const duration = Number(block?.durationMinutes)
    if (!Number.isInteger(duration) || duration <= 0) {
      errors.push(`${field}.blocks[${i}].durationMinutes must be a positive integer`)
    }
    if (block?.type === 'period') periodCount += 1
    if (i > 0 && block?.type === 'break' && blocks[i - 1]?.type === 'break') {
      errors.push(`${field}.blocks[${i}] cannot be a break directly after another break`)
    }
  })

  if (blocks[0]?.type !== 'period') errors.push(`${field} cannot start with a break`)
  if (blocks[blocks.length - 1]?.type !== 'period') {
    errors.push(`${field} cannot end with a break`)
  }
  if (periodCount < minPeriods || periodCount > maxPeriods) {
    errors.push(
      `${field} must contain between ${minPeriods} and ${maxPeriods} period blocks (found ${periodCount})`
    )
  }

  return errors
}

/**
 * Validates the schedule-setting portion of a request body. School year and
 * grade/subject existence are handled by the controllers.
 */
export function validateScheduleSettingData(data: any): string[] {
  if (!data || typeof data !== 'object') return ['Request body is required']
  const errors: string[] = []

  if (data.enabledDays !== undefined) {
    const days = data.enabledDays
    if (!Array.isArray(days) || days.length === 0) {
      errors.push('enabledDays must be a non-empty array')
    } else {
      const invalid = days.filter((d: unknown) => !ALL_SCHEDULE_DAYS.includes(d as ScheduleDay))
      if (invalid.length > 0) {
        errors.push(`enabledDays contains invalid day(s): ${invalid.join(', ')}`)
      }
      if (new Set(days).size !== days.length) {
        errors.push('enabledDays must not contain duplicates')
      }
    }
  }

  errors.push(
    ...validateBellSchedule(data.bellSchedule, {
      minPeriods: 5,
      maxPeriods: 8,
      field: 'bellSchedule',
    })
  )

  if (data.saturdayBellSchedule !== undefined && data.saturdayBellSchedule !== null) {
    errors.push(
      ...validateBellSchedule(data.saturdayBellSchedule, {
        minPeriods: 1,
        maxPeriods: 8,
        field: 'saturdayBellSchedule',
      })
    )
  }

  if (data.minimumFreePeriodsPerDay !== undefined) {
    const v = data.minimumFreePeriodsPerDay
    if (!Number.isInteger(v) || v < 0) {
      errors.push('minimumFreePeriodsPerDay must be a non-negative integer')
    }
  }

  if (data.maximumWeeklyTaughtPeriods !== undefined && data.maximumWeeklyTaughtPeriods !== null) {
    const v = data.maximumWeeklyTaughtPeriods
    if (!Number.isInteger(v) || v <= 0) {
      errors.push('maximumWeeklyTaughtPeriods must be a positive integer or null')
    }
  }

  if (data.maximumConsecutivePeriods !== undefined && data.maximumConsecutivePeriods !== null) {
    const v = data.maximumConsecutivePeriods
    if (!Number.isInteger(v) || v <= 0) {
      errors.push('maximumConsecutivePeriods must be a positive integer or null')
    }
  }

  return errors
}

/** Picks the pure schedule-setting fields out of a lean/stored document. */
export function pickScheduleSettingData(doc: any): ScheduleSettingData {
  return {
    schoolYear: String(doc?.schoolYear ?? ''),
    enabledDays: ((doc?.enabledDays && doc.enabledDays.length
      ? doc.enabledDays
      : DEFAULT_ENABLED_DAYS) as ScheduleDay[]),
    bellSchedule: doc?.bellSchedule,
    saturdayBellSchedule: doc?.saturdayBellSchedule ?? null,
    minimumFreePeriodsPerDay: doc?.minimumFreePeriodsPerDay ?? 1,
    maximumWeeklyTaughtPeriods: doc?.maximumWeeklyTaughtPeriods ?? null,
    maximumConsecutivePeriods: doc?.maximumConsecutivePeriods ?? null,
  }
}

/**
 * Derives everything the UI (and later phases) need from a stored setting:
 * per-period times, finish time, period groups, weekly slot count and the
 * per-day teaching cap. Assumes the setting has been validated.
 */
export function deriveScheduleSetting(setting: ScheduleSettingData): ScheduleSettingDerived {
  const enabledDays = (
    setting.enabledDays && setting.enabledDays.length ? setting.enabledDays : DEFAULT_ENABLED_DAYS
  ) as ScheduleDay[]

  const weekdayTimeline = buildBellTimeline(setting.bellSchedule)
  const minFreeRaw = Number(setting.minimumFreePeriodsPerDay)
  const minFree = Number.isFinite(minFreeRaw) && minFreeRaw > 0 ? Math.floor(minFreeRaw) : 0

  const saturdayEnabled = enabledDays.includes('saturday')
  const saturdaySchedule =
    setting.saturdayBellSchedule && Array.isArray(setting.saturdayBellSchedule.blocks) &&
    setting.saturdayBellSchedule.blocks.length > 0
      ? setting.saturdayBellSchedule
      : null
  const saturdayTimeline = saturdaySchedule
    ? buildBellTimeline(saturdaySchedule)
    : weekdayTimeline
  const saturdayUsedFallback = saturdayEnabled && !saturdaySchedule

  const perDay: DayDerived[] = enabledDays.map((day) => {
    const isSaturday = day === 'saturday'
    const timeline = isSaturday ? saturdayTimeline : weekdayTimeline
    return {
      day,
      source: isSaturday ? 'saturday' : 'weekday',
      periodsPerDay: timeline.periodCount,
      startTime:
        isSaturday && saturdaySchedule
          ? saturdaySchedule.startTime
          : setting.bellSchedule.startTime,
      finishTime: timeline.finishTime,
      periods: timeline.periods,
      groups: timeline.groups,
      dailyTeachingCap: Math.max(0, timeline.periodCount - minFree),
    }
  })

  const weeklySlotCount = perDay.reduce((sum, d) => sum + d.periodsPerDay, 0)

  return {
    periodsPerDay: weekdayTimeline.periodCount,
    periods: weekdayTimeline.periods,
    finishTime: weekdayTimeline.finishTime,
    groups: weekdayTimeline.groups,
    weeklySlotCount,
    enabledDays,
    enabledDayCount: enabledDays.length,
    dailyTeachingCap: Math.max(0, weekdayTimeline.periodCount - minFree),
    perDay,
    saturday: saturdayEnabled
      ? {
          enabled: true,
          usedFallbackToWeekday: saturdayUsedFallback,
          periodsPerDay: saturdayTimeline.periodCount,
          startTime: saturdaySchedule ? saturdaySchedule.startTime : setting.bellSchedule.startTime,
          finishTime: saturdayTimeline.finishTime,
          periods: saturdayTimeline.periods,
          groups: saturdayTimeline.groups,
        }
      : null,
  }
}
