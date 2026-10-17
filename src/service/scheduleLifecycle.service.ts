/**
 * scheduleLifecycle.service.ts
 *
 * Publish / clone / drift for school-wide schedules.
 *
 *  - Publish re-runs the validator AND the drift check against current data and
 *    blocks on any hard violation or drift. Unplaced lessons block publishing
 *    unless explicitly overridden (recorded on the schedule). The year's
 *    previously published schedule is archived first, so at most one published
 *    schedule exists per year.
 *  - Clone copies a published/archived schedule (entries, settings snapshot and
 *    locks) into a new draft.
 *  - Drift compares the stored fingerprint/snapshot to the current
 *    settings/requirements/assignments without ever modifying entries.
 */

import { Types } from 'mongoose'
import { Schedule } from '../models/schedule.model.js'
import { ScheduleEntry } from '../models/scheduleEntry.model.js'
import { Section } from '../models/section.model.js'
import { collectScheduleData, type CollectedScheduleData } from './scheduleData.service.js'
import { buildValidationSettings } from '../utils/scheduleLessons.util.js'
import {
  validateSchedule,
  type ScheduleEntry as ValidatorEntry,
  type ValidationSettings,
  type ScheduleViolation,
} from '../utils/scheduleValidator.util.js'
import { stableStringify } from '../utils/scheduleFingerprint.util.js'
import { getYearVariants } from '../utils/yearNormalizer.js'
import { persistDraftSchedule } from './scheduleGeneration.service.js'
import {
  EditError,
  buildUnplaced,
  previousUnplacedMap,
  toValidatorEntry,
  type ProposedEntry,
} from './scheduleEdit.service.js'
import type { ScheduleSettingData } from '../utils/scheduleSetting.util.js'

const sid = (v: any): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && v._id !== undefined) return String(v._id)
  return String(v)
}

function layoutSignature(settings: ValidationSettings | null): string | null {
  if (!settings) return null
  return stableStringify(
    settings.perDay.map((d) => ({ day: d.day, periodsPerDay: d.periodsPerDay, groups: d.groups }))
  )
}

export interface DriftEntryReport {
  entryId: string
  sectionId: string
  subjectId: string
  teacherId: string
  day: string
  period: number
  reasons: string[]
}

export interface DriftLessonReport {
  lessonId: string
  sectionId: string
  subjectId: string
  required: number
  placed: number
  reason: 'WEEKLY_COUNT_EXCEEDED' | 'WEEKLY_COUNT_SHORTFALL'
}

export interface DriftReport {
  scheduleId: string
  schoolYear: string
  status: string
  drifted: boolean
  generatedFingerprint: string
  currentFingerprint: string
  settings: {
    changed: boolean
    bellScheduleChanged: boolean
    enabledDaysChanged: boolean
  }
  counts: {
    invalidEntries: number
    sectionInactive: number
    noLongerRequired: number
    teacherReassigned: number
    bellChanged: number
    doubleInvalid: number
    weeklyCountMismatch: number
    weeklyCountExcess: number
  }
  entries: DriftEntryReport[]
  lessons: DriftLessonReport[]
}

/**
 * Compares a stored schedule against the current settings/requirements/
 * assignments. Read-only: it never modifies entries.
 */
export async function computeDrift(
  schedule: any,
  precomputed?: CollectedScheduleData
): Promise<DriftReport> {
  const data = precomputed ?? (await collectScheduleData(schedule.schoolYear))

  const snapshotSettings = (schedule.settingsSnapshot as ScheduleSettingData) ?? null
  const snapshotValidation = snapshotSettings ? safeValidationSettings(snapshotSettings) : null

  const settingsChanged = stableStringify(snapshotSettings) !== stableStringify(data.settingData)
  const bellScheduleChanged =
    layoutSignature(snapshotValidation) !== layoutSignature(data.settings)
  const enabledDaysChanged =
    stableStringify(snapshotSettings?.enabledDays ?? null) !==
    stableStringify(data.settingData?.enabledDays ?? null)

  const sections = await Section.find({ schoolYear: { $in: getYearVariants(schedule.schoolYear) } })
    .select('_id isActive')
    .lean()
  const activeSectionIds = new Set(
    sections.filter((s: any) => s.isActive).map((s: any) => String(s._id))
  )

  const lessonByKey = new Map(data.lessons.map((l) => [l.lessonId, l]))
  const entries: any[] = await ScheduleEntry.find({ scheduleId: schedule._id }).lean()
  const proposed: ProposedEntry[] = entries.map(toValidatorEntry)

  const layout = data.settings
    ? new Map(data.settings.perDay.map((d) => [d.day, d]))
    : new Map()

  const entryReports: DriftEntryReport[] = []
  const counts = {
    invalidEntries: 0,
    sectionInactive: 0,
    noLongerRequired: 0,
    teacherReassigned: 0,
    bellChanged: 0,
    doubleInvalid: 0,
    weeklyCountMismatch: 0,
    weeklyCountExcess: 0,
  }

  for (const e of proposed) {
    const reasons: string[] = []
    const key = `${e.sectionId}::${e.subjectId}`

    if (!activeSectionIds.has(e.sectionId)) {
      reasons.push('SECTION_INACTIVE')
      counts.sectionInactive++
    }
    const lesson = lessonByKey.get(key)
    if (!lesson) {
      reasons.push('SUBJECT_NO_LONGER_REQUIRED')
      counts.noLongerRequired++
    } else if (lesson.teacherId !== e.teacherId || lesson.teachingAssignmentId !== e.teachingAssignmentId) {
      reasons.push('TEACHER_REASSIGNED')
      counts.teacherReassigned++
    }

    const dl = layout.get(e.day as any) as any
    if (data.settings && (!dl || e.period < 1 || e.period > dl.periodsPerDay)) {
      reasons.push('BELL_SCHEDULE_CHANGED')
      counts.bellChanged++
    }

    if (reasons.length > 0) {
      entryReports.push({
        entryId: e.entryId,
        sectionId: e.sectionId,
        subjectId: e.subjectId,
        teacherId: e.teacherId,
        day: e.day,
        period: e.period,
        reasons,
      })
      counts.invalidEntries++
    }
  }

  // Double validity under the CURRENT settings.
  if (data.settings) {
    const groups = new Map<string, ProposedEntry[]>()
    for (const e of proposed) {
      if (!e.doubleGroupId) continue
      if (!groups.has(e.doubleGroupId)) groups.set(e.doubleGroupId, [])
      groups.get(e.doubleGroupId)!.push(e)
    }
    for (const [, list] of groups) {
      const ok = isDoubleGroupValid(list, layout)
      if (!ok) counts.doubleInvalid++
    }
  }

  // Weekly count mismatches per current lesson.
  const placedByKey = new Map<string, number>()
  for (const e of proposed) {
    const key = `${e.sectionId}::${e.subjectId}`
    placedByKey.set(key, (placedByKey.get(key) ?? 0) + 1)
  }
  const lessons: DriftLessonReport[] = []
  for (const l of data.lessons) {
    const placed = placedByKey.get(l.lessonId) ?? 0
    if (placed !== l.periodsPerWeek) {
      const excess = placed > l.periodsPerWeek
      if (excess) counts.weeklyCountExcess++
      lessons.push({
        lessonId: l.lessonId,
        sectionId: l.sectionId,
        subjectId: l.subjectId,
        required: l.periodsPerWeek,
        placed,
        reason: excess ? 'WEEKLY_COUNT_EXCEEDED' : 'WEEKLY_COUNT_SHORTFALL',
      })
    }
  }
  counts.weeklyCountMismatch = lessons.length

  // A shortfall is "unplaced lessons" (handled separately, overridable at
  // publish); only an excess or a data change counts as drift that blocks.
  const drifted =
    settingsChanged ||
    entryReports.length > 0 ||
    counts.doubleInvalid > 0 ||
    counts.weeklyCountExcess > 0

  return {
    scheduleId: String(schedule._id),
    schoolYear: schedule.schoolYear,
    status: schedule.status,
    drifted,
    generatedFingerprint: schedule.fingerprint ?? '',
    currentFingerprint: data.fingerprint,
    settings: { changed: settingsChanged, bellScheduleChanged, enabledDaysChanged },
    counts,
    entries: entryReports,
    lessons,
  }
}

function safeValidationSettings(setting: ScheduleSettingData): ValidationSettings | null {
  try {
    return buildValidationSettings(setting)
  } catch {
    return null
  }
}

function isDoubleGroupValid(list: ProposedEntry[], layout: Map<string, any>): boolean {
  if (list.length !== 2) return false
  const [a, b] = list
  const dl = layout.get(a.day)
  return (
    a.day === b.day &&
    Math.abs(a.period - b.period) === 1 &&
    !!dl &&
    dl.groupIndex[a.period - 1] === dl.groupIndex[b.period - 1] &&
    a.sectionId === b.sectionId &&
    a.subjectId === b.subjectId &&
    a.teacherId === b.teacherId
  )
}

// ─── publish ─────────────────────────────────────────────────────────────────

export interface PublishResult {
  scheduleId: string
  status: 'published'
  publishedAt: Date
  allowUnplacedOverride: boolean
  unplacedCount: number
  archivedPrevious: string[]
}

export async function publishSchedule(
  scheduleId: string,
  options: { allowUnplaced?: boolean; userId?: string | Types.ObjectId }
): Promise<PublishResult> {
  if (!Types.ObjectId.isValid(scheduleId)) throw new EditError(404, 'Schedule not found')
  const schedule = await Schedule.findById(scheduleId).lean()
  if (!schedule) throw new EditError(404, 'Schedule not found')
  if (schedule.status !== 'draft') {
    throw new EditError(409, `Only draft schedules can be published (this schedule is "${schedule.status}")`, {
      scheduleId: String(schedule._id),
      status: schedule.status,
    })
  }

  const data = await collectScheduleData(schedule.schoolYear)
  if (!data.settings || !data.precheck.ok) {
    throw new EditError(409, 'Schedule data failed the precheck; fix it before publishing', {
      precheck: data.precheck,
    })
  }

  const entries = await ScheduleEntry.find({ scheduleId: schedule._id }).lean()
  const proposed = entries.map(toValidatorEntry)

  const violations: ScheduleViolation[] = validateSchedule({
    settings: data.settings,
    lessons: data.lessons,
    entries: proposed,
  })
  if (violations.length > 0) {
    throw new EditError(409, 'Schedule has hard rule violations and cannot be published', {
      violations: violations.map((v) => ({ rule: v.code, message: v.message, ...v.refs })),
    })
  }

  const drift = await computeDrift(schedule, data)
  if (drift.drifted) {
    throw new EditError(409, 'Schedule data has drifted since generation; regenerate or clone it first', {
      drift,
    })
  }

  const unplaced = buildUnplaced(data.lessons, proposed, previousUnplacedMap(schedule))
  const allowUnplaced = !!options.allowUnplaced
  if (unplaced.length > 0 && !allowUnplaced) {
    throw new EditError(409, 'Unplaced lessons remain; pass allowUnplaced to publish anyway', {
      unplacedCount: unplaced.length,
      unplaced,
    })
  }

  const archivedPrevious: string[] = []
  const previous = await Schedule.find({
    schoolYear: schedule.schoolYear,
    status: 'published',
    _id: { $ne: schedule._id },
  })
    .select('_id')
    .lean()
  if (previous.length > 0) {
    const ids = previous.map((p: any) => p._id)
    await Schedule.updateMany({ _id: { $in: ids } }, { $set: { status: 'archived' } })
    archivedPrevious.push(...ids.map(String))
  }

  const publishedAt = new Date()
  const allowUnplacedOverride = allowUnplaced && unplaced.length > 0
  let updated
  try {
    updated = await Schedule.updateOne(
      { _id: schedule._id, status: 'draft' },
      {
        $set: {
          status: 'published',
          publishedAt,
          publishedBy: options.userId ? new Types.ObjectId(String(options.userId)) : null,
          allowUnplacedOverride,
          unplaced,
          entryCount: proposed.length,
        },
      }
    )
  } catch (error) {
    // Restore the previously published schedule if the write was rejected.
    if (archivedPrevious.length > 0) {
      await Schedule.updateMany({ _id: { $in: archivedPrevious } }, { $set: { status: 'published' } })
    }
    throw error
  }

  if ((updated.matchedCount ?? 0) !== 1) {
    throw new EditError(409, 'Schedule is no longer a draft; reload and retry', {
      scheduleId: String(schedule._id),
    })
  }

  return {
    scheduleId: String(schedule._id),
    status: 'published',
    publishedAt,
    allowUnplacedOverride,
    unplacedCount: unplaced.length,
    archivedPrevious,
  }
}

// ─── clone ───────────────────────────────────────────────────────────────────

export async function cloneSchedule(
  scheduleId: string,
  options: { replaceExistingDraft?: boolean; userId?: string | Types.ObjectId }
): Promise<any> {
  if (!Types.ObjectId.isValid(scheduleId)) throw new EditError(404, 'Schedule not found')
  const source = await Schedule.findById(scheduleId).lean()
  if (!source) throw new EditError(404, 'Schedule not found')
  if (source.status === 'draft') {
    throw new EditError(409, 'Only published or archived schedules can be cloned')
  }

  const existingDraft = await Schedule.findOne({ schoolYear: source.schoolYear, status: 'draft' })
    .select('_id')
    .lean()
  if (existingDraft && !options.replaceExistingDraft) {
    throw new EditError(409, 'A draft schedule already exists for this school year', {
      scheduleId: String(existingDraft._id),
    })
  }

  const docs = await ScheduleEntry.find({ scheduleId: source._id }).lean()
  const entries = docs.map((e: any) => ({
    sectionId: sid(e.sectionId),
    gradeId: sid(e.gradeId),
    subjectId: sid(e.subjectId),
    teacherId: sid(e.teacherId),
    teachingAssignmentId: sid(e.teachingAssignmentId),
    day: e.day,
    period: e.period,
    doubleGroupId: e.doubleGroupId ?? null,
    locked: !!e.locked,
  }))

  return persistDraftSchedule({
    schoolYear: source.schoolYear,
    fingerprint: source.fingerprint,
    settingsSnapshot: source.settingsSnapshot,
    generatedBy: options.userId,
    entries,
    unplaced: source.unplaced,
    stats: source.stats,
    clonedFrom: source._id,
  })
}
