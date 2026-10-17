/**
 * scheduleAccess.controller.ts
 *
 * Role-scoped reads of PUBLISHED schedules only. Drafts are never visible here.
 *
 * Relations used (from the existing data model):
 *  - teacher → sections: TeachingAssignment (via getTeacherSectionIds)
 *  - parent  → children:  Student.parentId, then StudentEnrollment for the
 *                         section/year
 *  - student → section:   NO relation exists between a `student` UserAccount and
 *                         a `Student` document in this codebase (invite tokens
 *                         cannot create student accounts and `Student` has no
 *                         userId), so a student-role caller is denied.
 */

import { Request, Response } from 'express'
import { Types } from 'mongoose'
import { Schedule } from '../models/schedule.model.js'
import { ScheduleEntry } from '../models/scheduleEntry.model.js'
import { Student } from '../models/student.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { normalizeYear, getYearVariants } from '../utils/yearNormalizer.js'
import { getTeacherSectionIds } from '../middlewares/access.middleware.js'
import { AuthRequest } from '../middlewares/auth.middleware.js'
import {
  ENTRY_SORT,
  currentFingerprint,
  entryPopulate,
  periodTimeIndex,
  serializeEntry,
  serializeSchedule,
} from './scheduleRead.controller.js'
import { ALL_SCHEDULE_DAYS, type ScheduleDay } from '../utils/scheduleSetting.util.js'

async function findPublished(schoolYear: string) {
  return Schedule.findOne({ schoolYear, status: 'published' }).sort({ publishedAt: -1 }).lean()
}

/**
 * GET /api/schedule/published?schoolYear=YYYY-YYYY
 * Roles: admin, coordinator
 *
 * The whole published schedule for a year plus every entry.
 */
export const getPublishedSchedule = async (req: Request, res: Response): Promise<void> => {
  const { schoolYear } = req.query
  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }
  try {
    const canonicalYear = normalizeYear(schoolYear)
    const schedule = await findPublished(canonicalYear)
    if (!schedule) {
      sendResponse(res, 404, false, 'No published schedule exists for this school year')
      return
    }
    const entries = await ScheduleEntry.find({ scheduleId: schedule._id })
      .populate(entryPopulate)
      .sort(ENTRY_SORT)
      .lean()
    const times = periodTimeIndex(schedule)
    const fp = await currentFingerprint(canonicalYear)
    sendResponse(res, 200, true, 'Published schedule fetched', {
      schedule: serializeSchedule(schedule, fp ? schedule.fingerprint !== fp : null),
      entries: entries.map((e: any) => serializeEntry(e, times)),
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching published schedule', null, error)
  }
}

/**
 * GET /api/schedule/my?schoolYear=YYYY-YYYY
 * Roles: teacher
 *
 * The caller's own entries in the year's published schedule, grouped by day
 * with each period's start/end time, plus the schedule id and publish time.
 */
export const getMySchedule = async (req: AuthRequest, res: Response): Promise<void> => {
  const { schoolYear } = req.query
  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }
  try {
    const canonicalYear = normalizeYear(schoolYear)
    const schedule = await findPublished(canonicalYear)
    if (!schedule) {
      sendResponse(res, 404, false, 'No published schedule exists for this school year')
      return
    }
    const teacherId = req.user!.id
    const entries = await ScheduleEntry.find({ scheduleId: schedule._id, teacherId })
      .populate(entryPopulate)
      .sort({ day: 1, period: 1 })
      .lean()

    const times = periodTimeIndex(schedule)
    const serialized = entries.map((e: any) => serializeEntry(e, times))
    const byDay = new Map<string, any[]>()
    for (const e of serialized) {
      if (!byDay.has(e.day)) byDay.set(e.day, [])
      byDay.get(e.day)!.push(e)
    }
    const days = ALL_SCHEDULE_DAYS.filter((d) => byDay.has(d)).map((day) => ({
      day,
      periods: byDay.get(day)!.sort((a, b) => a.period - b.period),
    }))

    sendResponse(res, 200, true, 'Your schedule fetched', {
      scheduleId: String(schedule._id),
      schoolYear: schedule.schoolYear,
      publishedAt: schedule.publishedAt ?? null,
      teacherId,
      count: serialized.length,
      days,
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching your schedule', null, error)
  }
}

async function canReadSection(
  req: AuthRequest,
  sectionId: string,
  schoolYear: string
): Promise<boolean> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return true

  if (user.role === 'teacher') {
    const sections = await getTeacherSectionIds(user.id, schoolYear)
    return sections.some((s) => s.toString() === sectionId)
  }

  if (user.role === 'parent') {
    const children = await Student.find({ parentId: user.id }).select('_id').lean()
    if (children.length === 0) return false
    const enrollment = await StudentEnrollment.findOne({
      studentId: { $in: children.map((c: any) => c._id) },
      sectionId,
      schoolYear: { $in: getYearVariants(schoolYear) },
      isActive: true,
    }).lean()
    return !!enrollment
  }

  // student role: no account↔Student relation exists in this codebase.
  return false
}

/**
 * GET /api/schedule/sections/:sectionId/published?schoolYear=YYYY-YYYY
 * Roles: admin, coordinator, teacher, parent
 *
 * A section's published class schedule. Teachers need an assignment on the
 * section; parents need a child enrolled in it. Students are denied (no
 * relation links a student account to a section).
 */
export const getSectionPublishedSchedule = async (req: AuthRequest, res: Response): Promise<void> => {
  const { sectionId } = req.params
  const { schoolYear } = req.query
  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }
  if (!Types.ObjectId.isValid(sectionId)) {
    sendResponse(res, 400, false, 'sectionId must be a valid id')
    return
  }
  try {
    const canonicalYear = normalizeYear(schoolYear)
    const allowed = await canReadSection(req, sectionId, canonicalYear)
    if (!allowed) {
      sendResponse(res, 403, false, 'Forbidden: you cannot access this section\'s schedule')
      return
    }

    const schedule = await findPublished(canonicalYear)
    if (!schedule) {
      sendResponse(res, 404, false, 'No published schedule exists for this school year')
      return
    }
    const entries = await ScheduleEntry.find({ scheduleId: schedule._id, sectionId })
      .populate(entryPopulate)
      .sort({ day: 1, period: 1 })
      .lean()
    const times = periodTimeIndex(schedule)
    const serialized = entries.map((e: any) => serializeEntry(e, times))

    sendResponse(res, 200, true, 'Section schedule fetched', {
      scheduleId: String(schedule._id),
      schoolYear: schedule.schoolYear,
      sectionId,
      publishedAt: schedule.publishedAt ?? null,
      count: serialized.length,
      days: ALL_SCHEDULE_DAYS.filter((d) => serialized.some((e: any) => e.day === d)),
      entries: serialized,
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching section schedule', null, error)
  }
}

// Re-exported for tests/tools that want the day order.
export const SCHEDULE_DAY_ORDER: ScheduleDay[] = ALL_SCHEDULE_DAYS
