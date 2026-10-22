import { Request, Response } from 'express'
import { Types } from 'mongoose'
import { Schedule } from '../models/schedule.model.js'
import { ScheduleEntry } from '../models/scheduleEntry.model.js'
import { GenerationJob } from '../models/generationJob.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { normalizeYear } from '../utils/yearNormalizer.js'
import { isValidSchoolYear } from '../utils/schoolYear.util.js'
import { buildDayPeriodTimes, type PeriodTime } from '../utils/scheduleLessons.util.js'
import { ALL_SCHEDULE_DAYS, type ScheduleDay } from '../utils/scheduleSetting.util.js'
import { collectScheduleData } from '../service/scheduleData.service.js'

/**
 * Computes the current data fingerprint for a year so a read can flag whether
 * the schedule has drifted since it was generated. Returns null when the data
 * cannot be collected (e.g. a failed precheck).
 */
export async function currentFingerprint(schoolYear: string): Promise<string | null> {
  try {
    const data = await collectScheduleData(schoolYear)
    return data.fingerprint
  } catch {
    return null
  }
}

export const serializeSchedule = (schedule: any, drifted: boolean | null = null) => ({
  scheduleId: String(schedule._id),
  schoolYear: schedule.schoolYear,
  status: schedule.status,
  fingerprint: schedule.fingerprint,
  drifted,
  entryCount: schedule.entryCount,
  version: schedule.version ?? 0,
  stats: schedule.stats,
  unplaced: (schedule.unplaced ?? []).map((u: any) => ({
    lessonId: u.lessonId,
    sectionId: u.sectionId,
    gradeId: u.gradeId,
    subjectId: u.subjectId,
    teacherId: u.teacherId,
    periods: u.periods,
    reason: u.reason,
    reasons: u.reasons instanceof Map ? Object.fromEntries(u.reasons) : u.reasons,
  })),
  settingsSnapshot: schedule.settingsSnapshot ?? null,
  publishedAt: schedule.publishedAt ?? null,
  publishedBy: schedule.publishedBy ? String(schedule.publishedBy) : null,
  allowUnplacedOverride: !!schedule.allowUnplacedOverride,
  clonedFrom: schedule.clonedFrom ? String(schedule.clonedFrom) : null,
  generatedBy: schedule.generatedBy ? String(schedule.generatedBy) : null,
  generatedAt: schedule.generatedAt,
  createdAt: schedule.createdAt,
  updatedAt: schedule.updatedAt,
})

/** day -> period -> { start, end }, derived from the schedule's settings snapshot. */
export function periodTimeIndex(schedule: any): Record<string, Map<number, PeriodTime>> {
  const snapshot = schedule?.settingsSnapshot
  const index: Record<string, Map<number, PeriodTime>> = {}
  if (!snapshot) return index
  try {
    const byDay = buildDayPeriodTimes(snapshot)
    for (const [day, periods] of Object.entries(byDay)) {
      index[day] = new Map(periods.map((p) => [p.period, p]))
    }
  } catch {
    // Malformed/legacy snapshot: leave times unresolved.
  }
  return index
}

export const serializeEntry = (
  entry: any,
  times: Record<string, Map<number, PeriodTime>>
) => {
  const time = times[entry.day]?.get(entry.period) ?? null
  return {
    entryId: String(entry._id),
    sectionId: String(entry.sectionId?._id ?? entry.sectionId),
    sectionName: entry.sectionId?.name ?? null,
    gradeId: String(entry.gradeId?._id ?? entry.gradeId),
    gradeLevel: entry.gradeId?.level ?? null,
    subjectId: String(entry.subjectId?._id ?? entry.subjectId),
    subjectName: entry.subjectId?.name ?? null,
    teacherId: String(entry.teacherId?._id ?? entry.teacherId),
    teacherName: entry.teacherId
      ? `${entry.teacherId.firstName ?? ''} ${entry.teacherId.lastName ?? ''}`.trim() || null
      : null,
    day: entry.day,
    period: entry.period,
    startTime: time?.start ?? null,
    endTime: time?.end ?? null,
    doubleGroupId: entry.doubleGroupId ?? null,
    locked: !!entry.locked,
  }
}

export const entryPopulate = [
  { path: 'sectionId', select: 'name gradeId' },
  { path: 'gradeId', select: 'level' },
  { path: 'subjectId', select: 'name' },
  { path: 'teacherId', select: 'firstName lastName' },
]

export const ENTRY_SORT = { sectionId: 1, day: 1, period: 1 } as const

/**
 * GET /api/schedule/schedules?schoolYear=YYYY-YYYY
 * Roles: admin, coordinator
 *
 * Lists the schedule documents for a year (newest first) without their entries.
 */
export const listSchedules = async (req: Request, res: Response): Promise<void> => {
  const { schoolYear } = req.query
  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }
  try {
    if (!(await isValidSchoolYear(schoolYear))) {
      sendResponse(
        res,
        400,
        false,
        `schoolYear "${schoolYear}" does not match any academic calendar`
      )
      return
    }
    const canonicalYear = normalizeYear(schoolYear)
    const [schedules, fp] = await Promise.all([
      Schedule.find({ schoolYear: canonicalYear }).sort({ createdAt: -1 }).lean(),
      currentFingerprint(canonicalYear),
    ])
    sendResponse(
      res,
      200,
      true,
      'Schedules fetched',
      schedules.map((s: any) => serializeSchedule(s, fp ? s.fingerprint !== fp : null))
    )
  } catch (error) {
    sendResponse(res, 500, false, 'Server error listing schedules', null, error)
  }
}

/**
 * GET /api/schedule/draft?schoolYear=YYYY-YYYY
 * Roles: admin, coordinator
 *
 * Returns the current draft schedule plus its entries for the year (404 when
 * there is none).
 */
export const getDraftSchedule = async (req: Request, res: Response): Promise<void> => {
  const { schoolYear } = req.query
  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }
  try {
    if (!(await isValidSchoolYear(schoolYear))) {
      sendResponse(
        res,
        400,
        false,
        `schoolYear "${schoolYear}" does not match any academic calendar`
      )
      return
    }
    const canonicalYear = normalizeYear(schoolYear)
    const schedule = await Schedule.findOne({ schoolYear: canonicalYear, status: 'draft' })
      .sort({ createdAt: -1 })
      .lean()
    if (!schedule) {
      sendResponse(res, 404, false, 'No draft schedule exists for this school year')
      return
    }
    const entries = await ScheduleEntry.find({ scheduleId: schedule._id })
      .populate(entryPopulate)
      .sort(ENTRY_SORT)
      .lean()
    const times = periodTimeIndex(schedule)
    const fp = await currentFingerprint(canonicalYear)
    sendResponse(res, 200, true, 'Draft schedule fetched', {
      schedule: serializeSchedule(schedule, fp ? schedule.fingerprint !== fp : null),
      entries: entries.map((e: any) => serializeEntry(e, times)),
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching draft schedule', null, error)
  }
}

/**
 * GET /api/schedule/schedules/:id
 * Roles: admin, coordinator
 */
export const getSchedule = async (req: Request, res: Response): Promise<void> => {
  try {
    const schedule = await Schedule.findById(req.params.id).lean()
    if (!schedule) {
      sendResponse(res, 404, false, 'Schedule not found')
      return
    }
    const entries = await ScheduleEntry.find({ scheduleId: schedule._id })
      .populate(entryPopulate)
      .sort(ENTRY_SORT)
      .lean()
    const times = periodTimeIndex(schedule)
    const fp = await currentFingerprint(schedule.schoolYear)
    sendResponse(res, 200, true, 'Schedule fetched', {
      schedule: serializeSchedule(schedule, fp ? schedule.fingerprint !== fp : null),
      entries: entries.map((e: any) => serializeEntry(e, times)),
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching schedule', null, error)
  }
}

/**
 * GET /api/schedule/schedules/:id/entries
 * Roles: admin, coordinator
 *
 * Filters (all optional): sectionId, teacherId, gradeId, day. Entries come back
 * with populated section/grade/subject/teacher names and each entry's period
 * start and end time taken from the schedule's settings snapshot.
 */
export const getScheduleEntries = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const { sectionId, teacherId, gradeId, day } = req.query

  if (!Types.ObjectId.isValid(id)) {
    sendResponse(res, 404, false, 'Schedule not found')
    return
  }

  const filter: Record<string, any> = { scheduleId: id }
  const applied: Record<string, string> = {}

  for (const [key, value] of Object.entries({ sectionId, teacherId, gradeId })) {
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string' || !Types.ObjectId.isValid(value)) {
      sendResponse(res, 400, false, `Invalid ${key} filter: must be a valid id`)
      return
    }
    filter[key] = value
    applied[key] = value
  }

  if (day !== undefined && day !== '') {
    if (typeof day !== 'string' || !ALL_SCHEDULE_DAYS.includes(day as ScheduleDay)) {
      sendResponse(res, 400, false, `Invalid day filter: must be one of ${ALL_SCHEDULE_DAYS.join(', ')}`)
      return
    }
    filter.day = day
    applied.day = day
  }

  try {
    const schedule = await Schedule.findById(id).lean()
    if (!schedule) {
      sendResponse(res, 404, false, 'Schedule not found')
      return
    }

    const entries = await ScheduleEntry.find(filter)
      .populate(entryPopulate)
      .sort(ENTRY_SORT)
      .lean()

    const times = periodTimeIndex(schedule)
    const fp = await currentFingerprint(schedule.schoolYear)

    sendResponse(res, 200, true, 'Schedule entries fetched', {
      scheduleId: String(schedule._id),
      schoolYear: schedule.schoolYear,
      status: schedule.status,
      drifted: fp ? schedule.fingerprint !== fp : null,
      filters: applied,
      count: entries.length,
      entries: entries.map((e: any) => serializeEntry(e, times)),
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching schedule entries', null, error)
  }
}

/**
 * DELETE /api/schedule/schedules/:id
 * Roles: admin, coordinator
 *
 * Discards a draft schedule and all of its entries. Refuses (409) any schedule
 * that is not a draft.
 */
export const deleteSchedule = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!Types.ObjectId.isValid(id)) {
    sendResponse(res, 404, false, 'Schedule not found')
    return
  }
  try {
    const schedule = await Schedule.findById(id).lean()
    if (!schedule) {
      sendResponse(res, 404, false, 'Schedule not found')
      return
    }
    if (schedule.status !== 'draft') {
      sendResponse(
        res,
        409,
        false,
        `Only draft schedules can be deleted (this schedule is "${schedule.status}")`,
        { scheduleId: String(schedule._id), status: schedule.status }
      )
      return
    }

    await Promise.all([
      GenerationJob.updateMany(
        { 'result.scheduleId': schedule._id },
        { $set: { 'result.scheduleId': null } }
      ),
      Schedule.updateMany({ clonedFrom: schedule._id }, { $set: { clonedFrom: null } }),
    ])

    const deleted = await ScheduleEntry.deleteMany({ scheduleId: schedule._id })
    await Schedule.deleteOne({ _id: schedule._id })

    sendResponse(res, 200, true, 'Draft schedule discarded', {
      scheduleId: String(schedule._id),
      deletedEntries: deleted.deletedCount ?? 0,
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting schedule', null, error)
  }
}
