/**
 * scheduleEdit.service.ts
 *
 * Draft-only manual editing of a generated schedule: move/swap/remove entries,
 * place an unplaced lesson and lock/unlock entries.
 *
 * Design constraints honoured here:
 *  - Every edit is checked with the existing pure validator against the
 *    schedule's OWN settings snapshot. Only violations *introduced* by the edit
 *    are reported, so pre-existing drift does not block unrelated edits.
 *  - Edits are serialized per schedule with an optimistic `version` counter; a
 *    stale version is a 409 and nothing is written.
 *  - A double period moves/swaps/removes as a unit and must stay inside one
 *    period group (enforced by re-validating the proposed state).
 *  - Locked entries cannot be moved, swapped or removed until unlocked.
 *  - The stored `unplaced` list and `entryCount` are kept consistent.
 */

import { Types } from 'mongoose'
import { Schedule } from '../models/schedule.model.js'
import { ScheduleEntry } from '../models/scheduleEntry.model.js'
import { collectScheduleData, type CollectedScheduleData } from './scheduleData.service.js'
import { buildValidationSettings } from '../utils/scheduleLessons.util.js'
import {
  validateSchedule,
  type ScheduleEntry as ValidatorEntry,
  type ValidationLesson,
  type ValidationSettings,
  type ScheduleViolation,
} from '../utils/scheduleValidator.util.js'
import { stableStringify } from '../utils/scheduleFingerprint.util.js'
import {
  ALL_SCHEDULE_DAYS,
  type ScheduleDay,
  type ScheduleSettingData,
} from '../utils/scheduleSetting.util.js'
import type { ScheduleUnplacedLesson } from '../types/schedule.type.js'

export type ProposedEntry = ValidatorEntry & { entryId: string }

export interface EditConflict {
  rule: string
  message: string
  lessonId?: string
  sectionId?: string
  subjectId?: string
  teacherId?: string
  day?: string
  period?: number
  doubleGroupId?: string
  expected?: number
  actual?: number
  entryIds: string[]
}

export class EditError extends Error {
  statusCode: number
  payload: Record<string, unknown> | null
  constructor(statusCode: number, message: string, payload?: Record<string, unknown>) {
    super(message)
    this.name = 'EditError'
    this.statusCode = statusCode
    this.payload = payload ?? null
  }
}

interface DraftContext {
  schedule: any
  entries: any[]
  settingData: ScheduleSettingData
  settings: ValidationSettings
  lessons: ValidationLesson[]
  currentData: CollectedScheduleData
}

const sid = (v: any): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && v._id !== undefined) return String(v._id)
  return String(v)
}

export function toValidatorEntry(e: any): ProposedEntry {
  return {
    entryId: String(e._id),
    sectionId: sid(e.sectionId),
    gradeId: sid(e.gradeId),
    day: e.day as ScheduleDay,
    period: Number(e.period),
    subjectId: sid(e.subjectId),
    teacherId: sid(e.teacherId),
    teachingAssignmentId: sid(e.teachingAssignmentId),
    doubleGroupId: e.doubleGroupId ?? null,
    locked: !!e.locked,
  }
}

function makeProposed(entries: any[]): ProposedEntry[] {
  return entries.map(toValidatorEntry)
}

/** Adds synthetic, permissive lessons for entries whose lesson is no longer in the current data. */
function withShadowLessons(lessons: ValidationLesson[], entries: Array<{ sectionId: string; gradeId: string; subjectId: string; teacherId: string; teachingAssignmentId: string }>): ValidationLesson[] {
  const known = new Set(lessons.map((l) => l.lessonId))
  const counts = new Map<string, number>()
  const sample = new Map<string, any>()
  for (const e of entries) {
    const key = `${e.sectionId}::${e.subjectId}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
    if (!sample.has(key)) sample.set(key, e)
  }
  const extra: ValidationLesson[] = []
  for (const [key, e] of sample) {
    if (known.has(key)) continue
    extra.push({
      lessonId: key,
      sectionId: e.sectionId,
      gradeId: e.gradeId,
      subjectId: e.subjectId,
      teacherId: e.teacherId,
      teachingAssignmentId: e.teachingAssignmentId,
      periodsPerWeek: counts.get(key) ?? 1,
      doublePeriod: 'allowed',
    })
  }
  return [...lessons, ...extra]
}

const violationKey = (v: ScheduleViolation): string =>
  stableStringify({ code: v.code, refs: v.refs })

function attachEntryIds(v: ScheduleViolation, proposed: ProposedEntry[]): string[] {
  const r = v.refs
  const ids: string[] = []
  for (const p of proposed) {
    if (r.sectionId && p.sectionId !== r.sectionId) continue
    if (r.subjectId && p.subjectId !== r.subjectId) continue
    if (r.teacherId && p.teacherId !== r.teacherId) continue
    if (r.day && p.day !== r.day) continue
    if (r.period !== undefined && p.period !== r.period) continue
    if (r.lessonId && `${p.sectionId}::${p.subjectId}` !== r.lessonId) continue
    ids.push(p.entryId)
  }
  return ids
}

function toConflict(v: ScheduleViolation, proposed: ProposedEntry[]): EditConflict {
  return {
    rule: v.code,
    message: v.message,
    lessonId: v.refs.lessonId,
    sectionId: v.refs.sectionId,
    subjectId: v.refs.subjectId,
    teacherId: v.refs.teacherId,
    day: v.refs.day,
    period: v.refs.period,
    doubleGroupId: v.refs.doubleGroupId,
    expected: v.refs.expected,
    actual: v.refs.actual,
    entryIds: attachEntryIds(v, proposed),
  }
}

/** Violations the proposed state introduces that the current state did not already have. */
function newConflicts(ctx: DraftContext, proposed: ProposedEntry[]): EditConflict[] {
  const baseline = validateSchedule({
    settings: ctx.settings,
    lessons: withShadowLessons(ctx.lessons, makeProposed(ctx.entries)),
    entries: makeProposed(ctx.entries),
  })
  const baselineKeys = new Set(baseline.map(violationKey))

  const violations = validateSchedule({
    settings: ctx.settings,
    lessons: withShadowLessons(ctx.lessons, proposed),
    entries: proposed,
  })
  return violations
    .filter((v) => !baselineKeys.has(violationKey(v)))
    .map((v) => toConflict(v, proposed))
}

export function buildUnplaced(
  lessons: ValidationLesson[],
  proposed: ProposedEntry[],
  previous: Map<string, ScheduleUnplacedLesson>,
  reasonOverrides?: Record<string, string>
): ScheduleUnplacedLesson[] {
  const counts = new Map<string, number>()
  for (const p of proposed) {
    const key = `${p.sectionId}::${p.subjectId}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const out: ScheduleUnplacedLesson[] = []
  for (const l of lessons) {
    const placed = counts.get(l.lessonId) ?? 0
    const shortfall = Math.max(0, l.periodsPerWeek - placed)
    if (shortfall > 0) {
      const prev = previous.get(l.lessonId)
      out.push({
        lessonId: l.lessonId,
        sectionId: l.sectionId,
        gradeId: l.gradeId,
        subjectId: l.subjectId,
        teacherId: l.teacherId,
        periods: shortfall,
        reason: reasonOverrides?.[l.lessonId] ?? prev?.reason ?? 'MANUALLY_UNPLACED',
        reasons: prev?.reasons ?? {},
      })
    }
  }
  return out
}

export function previousUnplacedMap(schedule: any): Map<string, ScheduleUnplacedLesson> {
  const map = new Map<string, ScheduleUnplacedLesson>()
  for (const u of schedule.unplaced ?? []) {
    map.set(u.lessonId, {
      lessonId: u.lessonId,
      sectionId: u.sectionId,
      gradeId: u.gradeId,
      subjectId: u.subjectId,
      teacherId: u.teacherId,
      periods: u.periods,
      reason: u.reason,
      reasons: u.reasons instanceof Map ? Object.fromEntries(u.reasons) : u.reasons ?? {},
    })
  }
  return map
}

export async function loadDraftContext(scheduleId: string): Promise<DraftContext> {
  if (!Types.ObjectId.isValid(scheduleId)) throw new EditError(404, 'Schedule not found')
  const schedule = await Schedule.findById(scheduleId).lean()
  if (!schedule) throw new EditError(404, 'Schedule not found')
  if (schedule.status !== 'draft') {
    throw new EditError(409, `Only draft schedules can be edited (this schedule is "${schedule.status}")`, {
      scheduleId: String(schedule._id),
      status: schedule.status,
    })
  }
  const [entries, currentData] = await Promise.all([
    ScheduleEntry.find({ scheduleId }).lean(),
    collectScheduleData(schedule.schoolYear),
  ])
  const settingData = (schedule.settingsSnapshot as ScheduleSettingData) ?? currentData.settingData
  if (!settingData) {
    throw new EditError(409, 'Schedule has no settings snapshot to validate against')
  }
  return {
    schedule,
    entries,
    settingData,
    settings: buildValidationSettings(settingData),
    lessons: currentData.lessons,
    currentData,
  }
}

function currentVersion(schedule: any): number {
  return Number.isFinite(Number(schedule.version)) ? Number(schedule.version) : 0
}

async function claimVersion(
  schedule: any,
  expectedVersion: unknown,
  setFields: Record<string, unknown>
): Promise<boolean> {
  const expected = Number.isFinite(Number(expectedVersion))
    ? Number(expectedVersion)
    : currentVersion(schedule)
  const guard: Record<string, any> = { _id: schedule._id, status: 'draft' }
  if (expected === 0) guard.$or = [{ version: 0 }, { version: { $exists: false } }]
  else guard.version = expected

  const res = await Schedule.updateOne(guard, { $inc: { version: 1 }, $set: setFields })
  return (res.matchedCount ?? 0) === 1
}

async function releaseVersion(schedule: any, expectedVersion: unknown, restore: Record<string, unknown>): Promise<void> {
  const expected = Number.isFinite(Number(expectedVersion))
    ? Number(expectedVersion)
    : currentVersion(schedule)
  await Schedule.updateOne(
    { _id: schedule._id, version: expected + 1 },
    { $inc: { version: -1 }, $set: restore }
  ).catch(() => undefined)
}

function assertDayPeriod(day: unknown, period: unknown): { day: ScheduleDay; period: number } {
  if (typeof day !== 'string' || !ALL_SCHEDULE_DAYS.includes(day as ScheduleDay)) {
    throw new EditError(400, `day must be one of ${ALL_SCHEDULE_DAYS.join(', ')}`)
  }
  const p = Number(period)
  if (!Number.isInteger(p) || p < 1) throw new EditError(400, 'period must be a positive integer')
  return { day: day as ScheduleDay, period: p }
}

// ─── move ────────────────────────────────────────────────────────────────────

export async function moveEntry(
  scheduleId: string,
  entryId: string,
  dayRaw: unknown,
  periodRaw: unknown,
  version: unknown
): Promise<{ version: number; conflicts?: EditConflict[]; moved: string[] }> {
  const { day, period } = assertDayPeriod(dayRaw, periodRaw)
  const ctx = await loadDraftContext(scheduleId)

  const target = ctx.entries.find((e) => String(e._id) === entryId)
  if (!target) throw new EditError(404, 'Entry not found on this schedule')

  const group = target.doubleGroupId
    ? ctx.entries.filter((e) => e.doubleGroupId === target.doubleGroupId)
    : [target]
  if (target.doubleGroupId && group.length !== 2) {
    throw new EditError(409, 'Double group is malformed; regenerate the schedule')
  }
  if (group.some((e) => e.locked)) {
    throw new EditError(409, 'Entry is locked; unlock it before moving')
  }

  const proposed = makeProposed(ctx.entries)
  const groupIds = new Set(group.map((e) => String(e._id)))
  const basePeriod = Math.min(...group.map((e) => Number(e.period)))
  const movedOriginals = group.map((e) => ({ _id: e._id, day: e.day, period: e.period }))

  for (const p of proposed) {
    if (!groupIds.has(p.entryId)) continue
    const original = group.find((e) => String(e._id) === p.entryId)!
    p.day = day
    p.period = period + (Number(original.period) - basePeriod)
  }

  const conflicts = newConflicts(ctx, proposed)
  if (conflicts.length > 0) throw new EditError(422, 'Edit would violate scheduling rules', { conflicts })

  const newUnplaced = buildUnplaced(ctx.lessons, proposed, previousUnplacedMap(ctx.schedule))
  const claimed = await claimVersion(ctx.schedule, version, {
    unplaced: newUnplaced,
    entryCount: proposed.length,
  })
  if (!claimed) {
    throw new EditError(409, 'Schedule was modified by someone else; reload and retry', {
      currentVersion: currentVersion(ctx.schedule),
    })
  }

  const newVersion = currentVersion(ctx.schedule) + 1
  try {
    for (const p of proposed) {
      if (!groupIds.has(p.entryId)) continue
      await ScheduleEntry.updateOne({ _id: p.entryId }, { $set: { day: p.day, period: p.period } })
    }
  } catch (error) {
    await releaseVersion(ctx.schedule, version, {
      unplaced: ctx.schedule.unplaced,
      entryCount: ctx.schedule.entryCount,
    })
    for (const o of movedOriginals) {
      await ScheduleEntry.updateOne({ _id: o._id }, { $set: { day: o.day, period: o.period } }).catch(() => undefined)
    }
    throw error
  }

  return { version: newVersion, moved: [...groupIds] }
}

// ─── swap ────────────────────────────────────────────────────────────────────

async function parkAndRestore(entries: Array<{ _id: any; day: ScheduleDay; period: number }>): Promise<void> {
  if (entries.length === 0) return
  await ScheduleEntry.bulkWrite(
    [
      ...entries.map((e) => ({
        updateOne: { filter: { _id: e._id }, update: { $set: { day: e.day, period: e.period + 200000 } } },
      })),
      ...entries.map((e) => ({
        updateOne: { filter: { _id: e._id }, update: { $set: { day: e.day, period: e.period } } },
      })),
    ],
    { ordered: true }
  )
}

export async function swapEntries(
  scheduleId: string,
  entryIdA: string,
  entryIdB: string,
  version: unknown
): Promise<{ version: number; swapped: string[] }> {
  if (entryIdA === entryIdB) throw new EditError(400, 'Cannot swap an entry with itself')
  const ctx = await loadDraftContext(scheduleId)

  const a = ctx.entries.find((e) => String(e._id) === entryIdA)
  const b = ctx.entries.find((e) => String(e._id) === entryIdB)
  if (!a || !b) throw new EditError(404, 'Entry not found on this schedule')

  const groupA = a.doubleGroupId ? ctx.entries.filter((e) => e.doubleGroupId === a.doubleGroupId) : [a]
  const groupB = b.doubleGroupId ? ctx.entries.filter((e) => e.doubleGroupId === b.doubleGroupId) : [b]

  if (a.doubleGroupId && a.doubleGroupId === b.doubleGroupId) {
    throw new EditError(422, 'Cannot swap two entries that belong to the same double period')
  }
  if (groupA.some((e) => e.locked) || groupB.some((e) => e.locked)) {
    throw new EditError(409, 'Entry is locked; unlock it before swapping')
  }
  if (!!a.doubleGroupId !== !!b.doubleGroupId || groupA.length !== groupB.length) {
    throw new EditError(422, 'Cannot swap a double period with a single period')
  }

  const sortByPeriod = (list: any[]) => [...list].sort((x, y) => Number(x.period) - Number(y.period))
  const sortedA = sortByPeriod(groupA)
  const sortedB = sortByPeriod(groupB)

  const posA = sortedA.map((e) => ({ day: e.day as ScheduleDay, period: Number(e.period) }))
  const posB = sortedB.map((e) => ({ day: e.day as ScheduleDay, period: Number(e.period) }))

  const proposed = makeProposed(ctx.entries)
  const targets = new Map<string, { day: ScheduleDay; period: number }>()
  sortedA.forEach((e, i) => targets.set(String(e._id), posB[i]))
  sortedB.forEach((e, i) => targets.set(String(e._id), posA[i]))

  for (const p of proposed) {
    const t = targets.get(p.entryId)
    if (t) {
      p.day = t.day
      p.period = t.period
    }
  }

  const conflicts = newConflicts(ctx, proposed)
  if (conflicts.length > 0) throw new EditError(422, 'Swap would violate scheduling rules', { conflicts })

  const newUnplaced = buildUnplaced(ctx.lessons, proposed, previousUnplacedMap(ctx.schedule))
  const claimed = await claimVersion(ctx.schedule, version, {
    unplaced: newUnplaced,
    entryCount: proposed.length,
  })
  if (!claimed) {
    throw new EditError(409, 'Schedule was modified by someone else; reload and retry', {
      currentVersion: currentVersion(ctx.schedule),
    })
  }

  const newVersion = currentVersion(ctx.schedule) + 1
  const originals = [...sortByPeriod(groupA), ...sortByPeriod(groupB)].map((e) => ({
    _id: String(e._id),
    day: e.day,
    period: Number(e.period),
  }))

  try {
    const ops: any[] = [
      ...originals.map((o) => ({
        updateOne: { filter: { _id: o._id }, update: { $set: { period: o.period + 100000 } } },
      })),
      ...sortedB.map((e, i) => ({
        updateOne: { filter: { _id: String(e._id) }, update: { $set: { day: posA[i].day, period: posA[i].period } } },
      })),
      ...sortedA.map((e, i) => ({
        updateOne: { filter: { _id: String(e._id) }, update: { $set: { day: posB[i].day, period: posB[i].period } } },
      })),
    ]
    await ScheduleEntry.bulkWrite(ops, { ordered: true })
  } catch (error) {
    await releaseVersion(ctx.schedule, version, {
      unplaced: ctx.schedule.unplaced,
      entryCount: ctx.schedule.entryCount,
    })
    await parkAndRestore(originals).catch(() => undefined)
    throw error
  }

  return { version: newVersion, swapped: [...targets.keys()] }
}

// ─── place unplaced lesson ───────────────────────────────────────────────────

export async function placeLesson(
  scheduleId: string,
  lessonId: string,
  dayRaw: unknown,
  periodRaw: unknown,
  double: unknown,
  version: unknown
): Promise<{ version: number; inserted: string[] }> {
  const { day, period } = assertDayPeriod(dayRaw, periodRaw)
  const ctx = await loadDraftContext(scheduleId)

  const lesson = ctx.lessons.find((l) => l.lessonId === lessonId)
  if (!lesson) throw new EditError(422, 'Lesson not found for this school year')

  const placedCount = ctx.entries.filter((e) => `${sid(e.sectionId)}::${sid(e.subjectId)}` === lessonId).length
  if (placedCount >= lesson.periodsPerWeek) {
    throw new EditError(409, 'Lesson is already fully placed')
  }

  const wantDouble = double === undefined ? lesson.doublePeriod === 'required' : !!double
  if (wantDouble && lesson.doublePeriod === 'none') {
    throw new EditError(422, 'Doubles are not allowed for this lesson')
  }
  if (wantDouble && lesson.periodsPerWeek - placedCount < 2) {
    throw new EditError(422, 'Not enough remaining periods to place a double')
  }

  const newIds: Types.ObjectId[] = []
  const newDocs: any[] = []
  const doubleGroupId = wantDouble ? new Types.ObjectId().toString() : null

  const make = (p: number): any => {
    const _id = new Types.ObjectId()
    newIds.push(_id)
    const doc = {
      _id,
      scheduleId: ctx.schedule._id,
      schoolYear: ctx.schedule.schoolYear,
      sectionId: new Types.ObjectId(lesson.sectionId),
      gradeId: new Types.ObjectId(lesson.gradeId),
      subjectId: new Types.ObjectId(lesson.subjectId),
      teacherId: new Types.ObjectId(lesson.teacherId),
      teachingAssignmentId: new Types.ObjectId(lesson.teachingAssignmentId),
      day,
      period: p,
      doubleGroupId,
      locked: false,
    }
    newDocs.push(doc)
    return doc
  }

  make(period)
  if (wantDouble) make(period + 1)

  const proposed = makeProposed(ctx.entries).concat(
    newDocs.map((d) => toValidatorEntry(d))
  )

  const conflicts = newConflicts(ctx, proposed)
  if (conflicts.length > 0) throw new EditError(422, 'Placement would violate scheduling rules', { conflicts })

  const newUnplaced = buildUnplaced(ctx.lessons, proposed, previousUnplacedMap(ctx.schedule))
  const claimed = await claimVersion(ctx.schedule, version, {
    unplaced: newUnplaced,
    entryCount: proposed.length,
  })
  if (!claimed) {
    throw new EditError(409, 'Schedule was modified by someone else; reload and retry', {
      currentVersion: currentVersion(ctx.schedule),
    })
  }

  const newVersion = currentVersion(ctx.schedule) + 1
  try {
    await ScheduleEntry.insertMany(newDocs)
  } catch (error) {
    await releaseVersion(ctx.schedule, version, {
      unplaced: ctx.schedule.unplaced,
      entryCount: ctx.schedule.entryCount,
    })
    await ScheduleEntry.deleteMany({ _id: { $in: newIds } }).catch(() => undefined)
    throw error
  }

  return { version: newVersion, inserted: newIds.map(String) }
}

// ─── remove ──────────────────────────────────────────────────────────────────

export async function removeEntry(
  scheduleId: string,
  entryId: string,
  version: unknown
): Promise<{ version: number; removed: string[] }> {
  const ctx = await loadDraftContext(scheduleId)

  const target = ctx.entries.find((e) => String(e._id) === entryId)
  if (!target) throw new EditError(404, 'Entry not found on this schedule')

  const group = target.doubleGroupId
    ? ctx.entries.filter((e) => e.doubleGroupId === target.doubleGroupId)
    : [target]
  if (group.some((e) => e.locked)) {
    throw new EditError(409, 'Entry is locked; unlock it before removing')
  }

  const removedIds = new Set(group.map((e) => String(e._id)))
  const proposed = makeProposed(ctx.entries).filter((p) => !removedIds.has(p.entryId))

  const newUnplaced = buildUnplaced(ctx.lessons, proposed, previousUnplacedMap(ctx.schedule), {
    [`${sid(target.sectionId)}::${sid(target.subjectId)}`]: 'REMOVED',
  })
  const claimed = await claimVersion(ctx.schedule, version, {
    unplaced: newUnplaced,
    entryCount: proposed.length,
  })
  if (!claimed) {
    throw new EditError(409, 'Schedule was modified by someone else; reload and retry', {
      currentVersion: currentVersion(ctx.schedule),
    })
  }

  const newVersion = currentVersion(ctx.schedule) + 1
  try {
    await ScheduleEntry.deleteMany({ _id: { $in: [...removedIds] } })
  } catch (error) {
    await releaseVersion(ctx.schedule, version, {
      unplaced: ctx.schedule.unplaced,
      entryCount: ctx.schedule.entryCount,
    })
    await ScheduleEntry.insertMany(group).catch(() => undefined)
    throw error
  }

  return { version: newVersion, removed: [...removedIds] }
}

// ─── lock / unlock ───────────────────────────────────────────────────────────

export interface LockFilter {
  sectionId?: string
  teacherId?: string
  gradeId?: string
  day?: string
}

export async function setEntriesLocked(
  scheduleId: string,
  options: { entryIds?: string[]; filter?: LockFilter; locked: boolean; version: unknown }
): Promise<{ version: number; matched: number; locked: boolean }> {
  const { entryIds, filter, locked, version } = options
  const selector: Record<string, any> = { scheduleId }

  if (entryIds && entryIds.length > 0) {
    const invalid = entryIds.filter((id) => !Types.ObjectId.isValid(id))
    if (invalid.length > 0) throw new EditError(400, 'entryIds must all be valid ids')
    selector._id = { $in: entryIds }
  } else if (filter && Object.keys(filter).length > 0) {
    for (const key of ['sectionId', 'teacherId', 'gradeId'] as const) {
      const value = filter[key]
      if (value === undefined || value === '') continue
      if (!Types.ObjectId.isValid(String(value))) throw new EditError(400, `${key} must be a valid id`)
      selector[key] = new Types.ObjectId(String(value))
    }
    if (filter.day) {
      if (!ALL_SCHEDULE_DAYS.includes(filter.day as ScheduleDay)) throw new EditError(400, 'day is invalid')
      selector.day = filter.day
    }
  } else {
    throw new EditError(400, 'Provide entryIds or a non-empty filter')
  }

  const ctx = await loadDraftContext(scheduleId)
  const claimed = await claimVersion(ctx.schedule, version, {})
  if (!claimed) {
    throw new EditError(409, 'Schedule was modified by someone else; reload and retry', {
      currentVersion: currentVersion(ctx.schedule),
    })
  }

  const newVersion = currentVersion(ctx.schedule) + 1
  try {
    const res = await ScheduleEntry.updateMany(selector, { $set: { locked } })
    return { version: newVersion, matched: res.matchedCount ?? 0, locked }
  } catch (error) {
    await releaseVersion(ctx.schedule, version, {})
    throw error
  }
}
