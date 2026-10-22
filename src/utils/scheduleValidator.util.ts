/**
 * scheduleValidator.util.ts
 *
 * Pure, self-contained hard-rule validator for a generated (or manually edited)
 * schedule. It has NO runtime dependency on any other project module — only
 * `import type` — so it can run inside a worker thread in both development
 * (native TypeScript stripping) and the compiled build.
 *
 * `validateSchedule` receives plain data and returns structured violations.
 * Later phases (manual edits, publishing) can reuse it unchanged.
 */

import type { DoublePeriodOption, ScheduleDay } from './scheduleSetting.util.js'

// ─── plain input shapes ──────────────────────────────────────────────────────

export interface DayDerivedInput {
  day: ScheduleDay
  periodsPerDay: number
  groups: number[]
  dailyTeachingCap: number
}

export interface ValidationSettings {
  enabledDays: ScheduleDay[]
  perDay: DayDerivedInput[]
  minimumFreePeriodsPerDay: number
  maximumWeeklyTaughtPeriods: number | null
  maximumConsecutivePeriods: number | null
}

export interface ValidationLesson {
  lessonId: string
  sectionId: string
  gradeId: string
  subjectId: string
  teacherId: string
  teachingAssignmentId: string
  periodsPerWeek: number
  doublePeriod: DoublePeriodOption
}

export interface ScheduleEntry {
  sectionId: string
  gradeId: string
  day: ScheduleDay
  period: number
  subjectId: string
  teacherId: string
  teachingAssignmentId: string
  doubleGroupId: string | null
  locked?: boolean
}

export interface ScheduleViolation {
  code: string
  message: string
  refs: {
    lessonId?: string
    sectionId?: string
    gradeId?: string
    subjectId?: string
    teacherId?: string
    day?: string
    period?: number
    doubleGroupId?: string
    expected?: number
    actual?: number
    [k: string]: string | number | undefined
  }
}

export interface ValidationInput {
  settings: ValidationSettings
  lessons: ValidationLesson[]
  entries: ScheduleEntry[]
}

// ─── layout ──────────────────────────────────────────────────────────────────

export interface DayLayout {
  day: ScheduleDay
  periodsPerDay: number
  dailyTeachingCap: number
  /** groupIndex[period - 1] -> group index */
  groupIndex: number[]
  /** groupStart[group] -> first period (1-based) */
  groupStart: number[]
  /** groupEnd[group] -> last period (1-based) */
  groupEnd: number[]
}

/**
 * Expands the bell groups into a per-period layout. Periods are numbered 1..N
 * in order and groups partition them (a break does not consume a period).
 */
export function buildLayout(settings: ValidationSettings): Map<ScheduleDay, DayLayout> {
  const map = new Map<ScheduleDay, DayLayout>()
  for (const d of settings.perDay) {
    const periodsPerDay = Math.max(0, Math.floor(d.periodsPerDay))
    const groupIndex = new Array<number>(periodsPerDay).fill(0)
    const groupStart: number[] = []
    const groupEnd: number[] = []
    let period = 1
    let gi = 0
    for (const size of d.groups) {
      const s = Math.max(0, Math.floor(size))
      if (s <= 0) continue
      groupStart[gi] = period
      for (let k = 0; k < s && period <= periodsPerDay; k++) {
        groupIndex[period - 1] = gi
        period++
      }
      groupEnd[gi] = period - 1
      gi++
    }
    // Defensive: any periods beyond the declared groups form singleton groups.
    while (period <= periodsPerDay) {
      groupStart[gi] = period
      groupIndex[period - 1] = gi
      groupEnd[gi] = period
      period++
      gi++
    }
    map.set(d.day, {
      day: d.day,
      periodsPerDay,
      dailyTeachingCap: Math.max(0, Math.floor(d.dailyTeachingCap)),
      groupIndex,
      groupStart,
      groupEnd,
    })
  }
  return map
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const SEP = '\u0001'
const k = (...parts: (string | number)[]) => parts.join(SEP)

/** Subject may appear at most once per day unless it must appear more often. */
export function subjectDailyLimit(periodsPerWeek: number, enabledDayCount: number): number {
  if (enabledDayCount <= 0) return periodsPerWeek
  return periodsPerWeek > enabledDayCount ? Math.ceil(periodsPerWeek / enabledDayCount) : 1
}

// ─── validateSchedule ────────────────────────────────────────────────────────

export function validateSchedule(input: ValidationInput): ScheduleViolation[] {
  const { settings, lessons, entries } = input
  const violations: ScheduleViolation[] = []
  const layout = buildLayout(settings)
  const enabledDaySet = new Set(settings.enabledDays)
  const lessonBySectionSubject = new Map<string, ValidationLesson>()
  for (const l of lessons) lessonBySectionSubject.set(k(l.sectionId, l.subjectId), l)

  const sectionSlot = new Map<string, ScheduleEntry>()
  const teacherSlot = new Map<string, ScheduleEntry>()
  const weeklyCount = new Map<string, number>()
  const teacherDayCount = new Map<string, number>()
  const teacherWeekCount = new Map<string, number>()
  const subjectDayCount = new Map<string, number>()
  const subjectDayDoubleGroups = new Map<string, Set<string>>()
  const doubleGroups = new Map<string, ScheduleEntry[]>()

  for (const e of entries) {
    const refs = {
      sectionId: e.sectionId,
      gradeId: e.gradeId,
      subjectId: e.subjectId,
      teacherId: e.teacherId,
      day: e.day,
      period: e.period,
    }

    const dl = layout.get(e.day)
    if (!enabledDaySet.has(e.day) || !dl) {
      violations.push({ code: 'INVALID_DAY', message: `Entry references a day that is not enabled: ${e.day}`, refs })
      continue
    }
    if (!Number.isInteger(e.period) || e.period < 1 || e.period > dl.periodsPerDay) {
      violations.push({
        code: 'INVALID_PERIOD',
        message: `Entry period ${e.period} is outside 1..${dl.periodsPerDay} on ${e.day}`,
        refs,
      })
      continue
    }

    const lesson = lessonBySectionSubject.get(k(e.sectionId, e.subjectId))
    if (!lesson) {
      violations.push({
        code: 'UNKNOWN_LESSON',
        message: `Entry does not correspond to any lesson for section ${e.sectionId} / subject ${e.subjectId}`,
        refs,
      })
    } else if (
      lesson.teacherId !== e.teacherId ||
      lesson.teachingAssignmentId !== e.teachingAssignmentId
    ) {
      violations.push({
        code: 'ENTRY_LESSON_MISMATCH',
        message: `Entry teacher/assignment does not match the lesson for section ${e.sectionId} / subject ${e.subjectId}`,
        refs: { ...refs, lessonId: lesson.lessonId },
      })
    }

    // Section slot conflict
    const sKey = k(e.sectionId, e.day, e.period)
    if (sectionSlot.has(sKey)) {
      violations.push({
        code: 'SECTION_SLOT_CONFLICT',
        message: `Section ${e.sectionId} has more than one lesson in ${e.day} period ${e.period}`,
        refs,
      })
    } else {
      sectionSlot.set(sKey, e)
    }

    // Teacher slot conflict
    const tKey = k(e.teacherId, e.day, e.period)
    if (teacherSlot.has(tKey)) {
      violations.push({
        code: 'TEACHER_SLOT_CONFLICT',
        message: `Teacher ${e.teacherId} has more than one lesson in ${e.day} period ${e.period}`,
        refs,
      })
    } else {
      teacherSlot.set(tKey, e)
    }

    if (lesson) weeklyCount.set(lesson.lessonId, (weeklyCount.get(lesson.lessonId) ?? 0) + 1)
    teacherDayCount.set(k(e.teacherId, e.day), (teacherDayCount.get(k(e.teacherId, e.day)) ?? 0) + 1)
    teacherWeekCount.set(e.teacherId, (teacherWeekCount.get(e.teacherId) ?? 0) + 1)
    const subjKey = k(e.sectionId, e.subjectId, e.day)
    subjectDayCount.set(subjKey, (subjectDayCount.get(subjKey) ?? 0) + 1)

    if (e.doubleGroupId) {
      if (!doubleGroups.has(e.doubleGroupId)) doubleGroups.set(e.doubleGroupId, [])
      doubleGroups.get(e.doubleGroupId)!.push(e)
      if (!subjectDayDoubleGroups.has(subjKey)) subjectDayDoubleGroups.set(subjKey, new Set())
      subjectDayDoubleGroups.get(subjKey)!.add(e.doubleGroupId)
    }
  }

  // Weekly count must never exceed the requirement (shortfall = unplaced).
  for (const lesson of lessons) {
    const count = weeklyCount.get(lesson.lessonId) ?? 0
    if (count > lesson.periodsPerWeek) {
      violations.push({
        code: 'WEEKLY_COUNT_EXCEEDED',
        message: `Section ${lesson.sectionId} / subject ${lesson.subjectId} has ${count} entries but only ${lesson.periodsPerWeek} were required`,
        refs: {
          lessonId: lesson.lessonId,
          sectionId: lesson.sectionId,
          subjectId: lesson.subjectId,
          expected: lesson.periodsPerWeek,
          actual: count,
        },
      })
    }
  }

  // Teacher daily cap
  for (const [key, count] of teacherDayCount) {
    const [teacherId, day] = key.split(SEP)
    const dl = layout.get(day as ScheduleDay)
    if (dl && count > dl.dailyTeachingCap) {
      violations.push({
        code: 'TEACHER_DAILY_CAP',
        message: `Teacher ${teacherId} teaches ${count} periods on ${day}, above the daily cap of ${dl.dailyTeachingCap}`,
        refs: { teacherId, day, expected: dl.dailyTeachingCap, actual: count },
      })
    }
  }

  // Teacher weekly cap
  if (settings.maximumWeeklyTaughtPeriods !== null) {
    for (const [teacherId, count] of teacherWeekCount) {
      if (count > settings.maximumWeeklyTaughtPeriods) {
        violations.push({
          code: 'TEACHER_WEEKLY_CAP',
          message: `Teacher ${teacherId} teaches ${count} periods this week, above the weekly cap of ${settings.maximumWeeklyTaughtPeriods}`,
          refs: { teacherId, expected: settings.maximumWeeklyTaughtPeriods, actual: count },
        })
      }
    }
  }

  // Subject per-day limit. A double period counts as a single occurrence.
  for (const lesson of lessons) {
    const limit = subjectDailyLimit(lesson.periodsPerWeek, settings.enabledDays.length)
    for (const day of settings.enabledDays) {
      const subjKey = k(lesson.sectionId, lesson.subjectId, day)
      const count =
        (subjectDayCount.get(subjKey) ?? 0) - (subjectDayDoubleGroups.get(subjKey)?.size ?? 0)
      if (count > limit) {
        violations.push({
          code: 'SUBJECT_DAY_LIMIT',
          message: `Section ${lesson.sectionId} / subject ${lesson.subjectId} appears ${count} times on ${day}, above the limit of ${limit}`,
          refs: {
            lessonId: lesson.lessonId,
            sectionId: lesson.sectionId,
            subjectId: lesson.subjectId,
            day,
            expected: limit,
            actual: count,
          },
        })
      }
    }
  }

  // Consecutive run per teacher (runs counted within a group; a break resets)
  if (settings.maximumConsecutivePeriods !== null) {
    const maxRun = settings.maximumConsecutivePeriods
    const occupiedByTeacherDay = new Map<string, Set<number>>()
    for (const e of entries) {
      const key = k(e.teacherId, e.day)
      if (!occupiedByTeacherDay.has(key)) occupiedByTeacherDay.set(key, new Set())
      occupiedByTeacherDay.get(key)!.add(e.period)
    }
    for (const [key, periods] of occupiedByTeacherDay) {
      const [teacherId, day] = key.split(SEP)
      const dl = layout.get(day as ScheduleDay)
      if (!dl) continue
      const groupCount = dl.groupStart.length
      for (let g = 0; g < groupCount; g++) {
        const start = dl.groupStart[g]
        const end = dl.groupEnd[g]
        let run = 0
        for (let p = start; p <= end; p++) {
          if (periods.has(p)) {
            run++
            if (run > maxRun) {
              violations.push({
                code: 'TEACHER_CONSECUTIVE',
                message: `Teacher ${teacherId} has a run of ${run} consecutive periods on ${day} (max ${maxRun})`,
                refs: { teacherId, day, expected: maxRun, actual: run },
              })
              break
            }
          } else {
            run = 0
          }
        }
      }
    }
  }

  // Doubles
  for (const [groupId, list] of doubleGroups) {
    if (list.length !== 2) {
      violations.push({
        code: 'DOUBLE_INVALID',
        message: `Double group ${groupId} has ${list.length} entries (exactly two are required)`,
        refs: { doubleGroupId: groupId, expected: 2, actual: list.length },
      })
      continue
    }
    const [a, b] = list
    const dl = layout.get(a.day)
    const sameDay = a.day === b.day
    const adjacent = Math.abs(a.period - b.period) === 1
    const sameGroup = !!dl && dl.groupIndex[a.period - 1] === dl.groupIndex[b.period - 1]
    if (
      !sameDay ||
      !adjacent ||
      !sameGroup ||
      a.sectionId !== b.sectionId ||
      a.subjectId !== b.subjectId ||
      a.teacherId !== b.teacherId
    ) {
      violations.push({
        code: 'DOUBLE_INVALID',
        message: `Double group ${groupId} is not two adjacent periods in the same block for one section/subject/teacher`,
        refs: { doubleGroupId: groupId, sectionId: a.sectionId, subjectId: a.subjectId, day: a.day },
      })
    }
  }

  // None must not produce doubles; required must produce one when fully placed.
  for (const lesson of lessons) {
    const lessonEntries = entries.filter(
      (e) => e.sectionId === lesson.sectionId && e.subjectId === lesson.subjectId
    )
    const hasDouble = lessonEntries.some((e) => !!e.doubleGroupId)
    if (lesson.doublePeriod === 'none' && hasDouble) {
      violations.push({
        code: 'DOUBLE_NOT_ALLOWED',
        message: `Section ${lesson.sectionId} / subject ${lesson.subjectId} has a double period but doubles are not allowed`,
        refs: { lessonId: lesson.lessonId, sectionId: lesson.sectionId, subjectId: lesson.subjectId },
      })
    }
    if (lesson.doublePeriod === 'required' && lessonEntries.length >= lesson.periodsPerWeek && !hasDouble) {
      violations.push({
        code: 'REQUIRED_DOUBLE_MISSING',
        message: `Section ${lesson.sectionId} / subject ${lesson.subjectId} requires a double period but none was placed`,
        refs: { lessonId: lesson.lessonId, sectionId: lesson.sectionId, subjectId: lesson.subjectId },
      })
    }
  }

  return violations
}
