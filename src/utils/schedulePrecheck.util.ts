/**
 * schedulePrecheck.util.ts
 *
 * Pure, dependency-free precheck for the school-wide schedule.
 *
 * It takes plain data only (no Mongoose models, no I/O) and returns every
 * problem it finds at once, so later phases can reuse it to validate edits and
 * to gate publishing. All numbers are derived through the pure schedule-setting
 * helpers.
 */

import {
  deriveScheduleSetting,
  validateScheduleSettingData,
  type DoublePeriodOption,
  type ScheduleSettingData,
  type ScheduleSettingDerived,
} from './scheduleSetting.util.js'

export type PrecheckSeverity = 'error' | 'warning'

export interface PrecheckRefs {
  gradeId?: string
  gradeName?: string
  sectionId?: string
  sectionName?: string
  subjectId?: string
  subjectName?: string
  teacherId?: string
  teacherName?: string
  /** Generic numeric context (required/available counts, caps, loads, ...). */
  required?: number
  available?: number
  weeklyCap?: number
  dailyCap?: number
  enabledDays?: number
  assignedPeriods?: number
  capacity?: number
  periodsPerWeek?: number
  count?: number
  occurrences?: number
  field?: string
  reason?: string
}

export interface PrecheckItem {
  code: string
  severity: PrecheckSeverity
  message: string
  refs: PrecheckRefs
}

export interface PrecheckSummary {
  sections: number
  teachers: number
  totalLessonsToPlace: number
  totalSlots: number
  weeklySlotsPerSection: number
}

export interface PrecheckResult {
  ok: boolean
  errors: PrecheckItem[]
  warnings: PrecheckItem[]
  summary: PrecheckSummary
}

export interface PrecheckGrade {
  _id: string
  level: string
}

export interface PrecheckSection {
  _id: string
  gradeId: string
  name: string
  isActive: boolean
}

export interface PrecheckSubject {
  _id: string
  name: string
}

export interface PrecheckRequirement {
  gradeId: string
  subjectId: string
  periodsPerWeek: number
  doublePeriod: DoublePeriodOption
}

export interface PrecheckAssignment {
  _id: string
  sectionId: string
  gradeId: string
  teacherId: string
  subjectId: string | null
  role: 'homeroom' | 'subject'
}

export interface PrecheckTeacher {
  _id: string
  name: string
}

export interface PrecheckInput {
  schoolYear: string
  settings: ScheduleSettingData | null
  grades: PrecheckGrade[]
  sections: PrecheckSection[]
  subjects: PrecheckSubject[]
  requirements: PrecheckRequirement[]
  assignments: PrecheckAssignment[]
  teachers: PrecheckTeacher[]
}

export function runSchedulePrecheck(input: PrecheckInput): PrecheckResult {
  const errors: PrecheckItem[] = []
  const warnings: PrecheckItem[] = []

  const gradeById = new Map(input.grades.map((g) => [g._id, g]))
  const subjectById = new Map(input.subjects.map((s) => [s._id, s]))
  const teacherById = new Map(input.teachers.map((t) => [t._id, t]))

  const subjectName = (id: string | null): string =>
    (id && subjectById.get(id)?.name) || 'Unknown subject'
  const gradeName = (id: string | null): string =>
    (id && gradeById.get(id)?.level) || 'Unknown grade'

  // ── 1. settings ────────────────────────────────────────────────────────────
  let derived: ScheduleSettingDerived | null = null
  let weeklySlots = 0

  if (!input.settings) {
    errors.push({
      code: 'SETTINGS_MISSING',
      severity: 'error',
      message: `No schedule settings are configured for school year ${input.schoolYear}.`,
      refs: {},
    })
  } else {
    const settingErrors = validateScheduleSettingData(input.settings)
    if (settingErrors.length > 0) {
      for (const message of settingErrors) {
        errors.push({ code: 'SETTINGS_INVALID', severity: 'error', message, refs: {} })
      }
    } else {
      derived = deriveScheduleSetting(input.settings)
      weeklySlots = derived.weeklySlotCount
    }
  }

  const settingsUsable = derived !== null

  // ── indexing ───────────────────────────────────────────────────────────────
  const requirementsByGrade = new Map<string, PrecheckRequirement[]>()
  for (const r of input.requirements) {
    if (!requirementsByGrade.has(r.gradeId)) requirementsByGrade.set(r.gradeId, [])
    requirementsByGrade.get(r.gradeId)!.push(r)
  }

  const activeSections = input.sections.filter((s) => s.isActive)
  const sectionsByGrade = new Map<string, PrecheckSection[]>()
  for (const s of activeSections) {
    if (!sectionsByGrade.has(s.gradeId)) sectionsByGrade.set(s.gradeId, [])
    sectionsByGrade.get(s.gradeId)!.push(s)
  }

  // ── 2 & 3 & 7. grade totals vs slots, missing requirements, subject over slots
  for (const grade of input.grades) {
    const reqs = requirementsByGrade.get(grade._id) ?? []
    const gradeSections = sectionsByGrade.get(grade._id) ?? []

    if (reqs.length === 0) {
      if (gradeSections.length > 0) {
        warnings.push({
          code: 'GRADE_NO_REQUIREMENTS',
          severity: 'warning',
          message: `Grade "${grade.level}" has ${gradeSections.length} active section(s) but no weekly period requirements.`,
          refs: {
            gradeId: grade._id,
            gradeName: grade.level,
            count: gradeSections.length,
          },
        })
      }
      continue
    }

    const totalRequired = reqs.reduce((sum, r) => sum + r.periodsPerWeek, 0)

    if (settingsUsable) {
      if (totalRequired > weeklySlots) {
        errors.push({
          code: 'GRADE_OVER_SLOTS',
          severity: 'error',
          message: `Grade "${grade.level}" requires ${totalRequired} period(s) per week but only ${weeklySlots} slot(s) are available.`,
          refs: {
            gradeId: grade._id,
            gradeName: grade.level,
            required: totalRequired,
            available: weeklySlots,
          },
        })
      } else if (totalRequired < weeklySlots) {
        warnings.push({
          code: 'GRADE_UNDER_SLOTS',
          severity: 'warning',
          message: `Grade "${grade.level}" requires ${totalRequired} period(s) per week, leaving ${weeklySlots - totalRequired} unfilled slot(s).`,
          refs: {
            gradeId: grade._id,
            gradeName: grade.level,
            required: totalRequired,
            available: weeklySlots,
          },
        })
      }
    }

    for (const r of reqs) {
      if (settingsUsable && r.periodsPerWeek > weeklySlots) {
        errors.push({
          code: 'SUBJECT_OVER_SLOTS',
          severity: 'error',
          message: `Subject "${subjectName(r.subjectId)}" in grade "${grade.level}" requires ${r.periodsPerWeek} period(s) per week, which exceeds the ${weeklySlots} weekly slot(s).`,
          refs: {
            gradeId: grade._id,
            gradeName: grade.level,
            subjectId: r.subjectId,
            subjectName: subjectName(r.subjectId),
            required: r.periodsPerWeek,
            available: weeklySlots,
          },
        })
      }
    }
  }

  // ── 4. exactly one assignment per required subject per active section ──────
  const assignmentsBySectionSubject = new Map<string, PrecheckAssignment[]>()
  for (const a of input.assignments) {
    if (a.role !== 'subject' || !a.subjectId) continue
    const key = `${a.sectionId}::${a.subjectId}`
    if (!assignmentsBySectionSubject.has(key)) assignmentsBySectionSubject.set(key, [])
    assignmentsBySectionSubject.get(key)!.push(a)
  }

  for (const [gradeId, reqs] of requirementsByGrade) {
    const gradeSections = sectionsByGrade.get(gradeId) ?? []
    for (const section of gradeSections) {
      for (const r of reqs) {
        const list = assignmentsBySectionSubject.get(`${section._id}::${r.subjectId}`) ?? []
        if (list.length === 0) {
          errors.push({
            code: 'SUBJECT_ASSIGNMENT_MISSING',
            severity: 'error',
            message: `Grade "${gradeName(gradeId)}" section "${section.name}" has no teaching assignment for required subject "${subjectName(r.subjectId)}".`,
            refs: {
              gradeId,
              gradeName: gradeName(gradeId),
              sectionId: section._id,
              sectionName: section.name,
              subjectId: r.subjectId,
              subjectName: subjectName(r.subjectId),
            },
          })
        } else if (list.length > 1) {
          errors.push({
            code: 'SUBJECT_ASSIGNMENT_DUPLICATE',
            severity: 'error',
            message: `Grade "${gradeName(gradeId)}" section "${section.name}" has ${list.length} teaching assignments for required subject "${subjectName(r.subjectId)}" (exactly one is required).`,
            refs: {
              gradeId,
              gradeName: gradeName(gradeId),
              sectionId: section._id,
              sectionName: section.name,
              subjectId: r.subjectId,
              subjectName: subjectName(r.subjectId),
              occurrences: list.length,
            },
          })
        }
      }
    }
  }

  // ── 5. teacher capacity ────────────────────────────────────────────────────
  if (settingsUsable && derived) {
    const periodsByGradeSubject = new Map<string, number>()
    for (const r of input.requirements) {
      periodsByGradeSubject.set(`${r.gradeId}::${r.subjectId}`, r.periodsPerWeek)
    }

    const loadByTeacher = new Map<string, number>()
    for (const a of input.assignments) {
      if (a.role !== 'subject' || !a.subjectId) continue
      const periods = periodsByGradeSubject.get(`${a.gradeId}::${a.subjectId}`)
      if (!periods) continue
      loadByTeacher.set(a.teacherId, (loadByTeacher.get(a.teacherId) ?? 0) + periods)
    }

    const dailyCapacityTotal = derived.perDay.reduce((sum, d) => sum + d.dailyTeachingCap, 0)
    const weeklyCap = input.settings?.maximumWeeklyTaughtPeriods ?? null
    const capacity = weeklyCap === null ? dailyCapacityTotal : Math.min(weeklyCap, dailyCapacityTotal)

    for (const [teacherId, load] of loadByTeacher) {
      if (load > capacity) {
        const teacher = teacherById.get(teacherId)
        errors.push({
          code: 'TEACHER_OVER_CAPACITY',
          severity: 'error',
          message: `Teacher "${teacher?.name ?? teacherId}" is assigned ${load} period(s) per week but has a capacity of only ${capacity}.`,
          refs: {
            teacherId,
            teacherName: teacher?.name,
            assignedPeriods: load,
            capacity,
            weeklyCap: weeklyCap ?? undefined,
            dailyCap: derived.dailyTeachingCap,
            enabledDays: derived.enabledDayCount,
          },
        })
      }
    }
  }

  // ── 6. double-period feasibility ───────────────────────────────────────────
  if (settingsUsable && derived) {
    const maxGroup = derived.perDay.reduce(
      (max, d) => Math.max(max, ...d.groups, 0),
      0
    )

    for (const r of input.requirements) {
      if (r.doublePeriod !== 'required') continue

      if (r.periodsPerWeek < 2) {
        errors.push({
          code: 'DOUBLE_PERIOD_INVALID',
          severity: 'error',
          message: `Subject "${subjectName(r.subjectId)}" in grade "${gradeName(r.gradeId)}" requires a double period but only has ${r.periodsPerWeek} period(s) per week.`,
          refs: {
            gradeId: r.gradeId,
            gradeName: gradeName(r.gradeId),
            subjectId: r.subjectId,
            subjectName: subjectName(r.subjectId),
            periodsPerWeek: r.periodsPerWeek,
          },
        })
      }

      if (maxGroup < 2) {
        errors.push({
          code: 'DOUBLE_PERIOD_INFEASIBLE',
          severity: 'error',
          message: `Subject "${subjectName(r.subjectId)}" in grade "${gradeName(r.gradeId)}" requires a double period but no bell schedule day contains two consecutive periods.`,
          refs: {
            gradeId: r.gradeId,
            gradeName: gradeName(r.gradeId),
            subjectId: r.subjectId,
            subjectName: subjectName(r.subjectId),
            periodsPerWeek: r.periodsPerWeek,
          },
        })
      }
    }
  }

  // ── summary ────────────────────────────────────────────────────────────────
  let totalLessonsToPlace = 0
  for (const [gradeId, reqs] of requirementsByGrade) {
    const sectionCount = (sectionsByGrade.get(gradeId) ?? []).length
    const gradeWeekly = reqs.reduce((sum, r) => sum + r.periodsPerWeek, 0)
    totalLessonsToPlace += gradeWeekly * sectionCount
  }

  const summary: PrecheckSummary = {
    sections: activeSections.length,
    teachers: input.teachers.length,
    totalLessonsToPlace,
    totalSlots: weeklySlots * activeSections.length,
    weeklySlotsPerSection: weeklySlots,
  }

  return { ok: errors.length === 0, errors, warnings, summary }
}
