/**
 * scheduleLessons.util.ts
 *
 * Pure helpers that turn stored, plain schedule data into the shapes the solver
 * and validator consume:
 *  - `buildValidationSettings` expands a stored setting into per-day layout;
 *  - `buildLessons` turns requirements + teaching assignments into the flat
 *    lesson list placed by the solver.
 *
 * No I/O and no Mongoose models here — controllers gather documents and pass
 * plain objects in.
 */

import type { ScheduleDay } from './scheduleSetting.util.js'
import type { ValidationLesson, ValidationSettings } from './scheduleValidator.util.js'
import type { DoublePeriodOption } from './scheduleSetting.util.js'
import {
  deriveScheduleSetting,
  type ScheduleSettingData,
} from './scheduleSetting.util.js'

export function buildValidationSettings(setting: ScheduleSettingData): ValidationSettings {
  const derived = deriveScheduleSetting(setting)
  return {
    enabledDays: derived.enabledDays as ScheduleDay[],
    perDay: derived.perDay.map((d) => ({
      day: d.day,
      periodsPerDay: d.periodsPerDay,
      groups: d.groups,
      dailyTeachingCap: d.dailyTeachingCap,
    })),
    minimumFreePeriodsPerDay: Number(setting.minimumFreePeriodsPerDay ?? 0),
    maximumWeeklyTaughtPeriods: setting.maximumWeeklyTaughtPeriods ?? null,
    maximumConsecutivePeriods: setting.maximumConsecutivePeriods ?? null,
  }
}

export interface PeriodTime {
  period: number
  start: string
  end: string
}

/**
 * Builds a `day -> [{ period, start, end }]` index from a stored setting, so
 * readers can attach each entry's period start/end time without recomputing the
 * bell schedule. Saturday uses its own bell schedule when configured.
 */
export function buildDayPeriodTimes(
  setting: ScheduleSettingData
): Record<string, PeriodTime[]> {
  const derived = deriveScheduleSetting(setting)
  const out: Record<string, PeriodTime[]> = {}
  for (const d of derived.perDay) {
    out[d.day] = d.periods.map((p, i) => ({
      period: i + 1,
      start: p.start,
      end: p.end,
    }))
  }
  return out
}

export interface LessonBuildSection {
  _id: string
  gradeId: string
}

export interface LessonBuildRequirement {
  gradeId: string
  subjectId: string
  periodsPerWeek: number
  doublePeriod: DoublePeriodOption
}

export interface LessonBuildAssignment {
  _id: string
  sectionId: string
  teacherId: string
  subjectId: string | null
  role: 'homeroom' | 'subject'
}

export interface LessonBuildInput {
  /** Active sections only. */
  sections: LessonBuildSection[]
  requirements: LessonBuildRequirement[]
  /** Assignments scoped to the active sections of the requested school year. */
  assignments: LessonBuildAssignment[]
}

/**
 * Builds the lesson list for every active section that has a complete set of
 * subject assignments. A subject is only materialised when exactly one
 * teaching assignment matches (`section`, `subject`); anything else is left for
 * the precheck to report.
 */
export function buildLessons(input: LessonBuildInput): ValidationLesson[] {
  const requirementsByGrade = new Map<string, LessonBuildRequirement[]>()
  for (const r of input.requirements) {
    if (!requirementsByGrade.has(r.gradeId)) requirementsByGrade.set(r.gradeId, [])
    requirementsByGrade.get(r.gradeId)!.push(r)
  }

  const assignmentsBySectionSubject = new Map<string, LessonBuildAssignment[]>()
  for (const a of input.assignments) {
    if (a.role !== 'subject' || !a.subjectId) continue
    const key = `${a.sectionId}::${a.subjectId}`
    if (!assignmentsBySectionSubject.has(key)) assignmentsBySectionSubject.set(key, [])
    assignmentsBySectionSubject.get(key)!.push(a)
  }

  const lessons: ValidationLesson[] = []
  for (const section of input.sections) {
    const reqs = requirementsByGrade.get(section.gradeId) ?? []
    for (const r of reqs) {
      const matches = assignmentsBySectionSubject.get(`${section._id}::${r.subjectId}`) ?? []
      if (matches.length !== 1) continue
      const assignment = matches[0]
      lessons.push({
        lessonId: `${section._id}::${r.subjectId}`,
        sectionId: section._id,
        gradeId: section.gradeId,
        subjectId: r.subjectId,
        teacherId: assignment.teacherId,
        teachingAssignmentId: assignment._id,
        periodsPerWeek: r.periodsPerWeek,
        doublePeriod: r.doublePeriod,
      })
    }
  }

  lessons.sort((a, b) => (a.lessonId < b.lessonId ? -1 : a.lessonId > b.lessonId ? 1 : 0))
  return lessons
}
