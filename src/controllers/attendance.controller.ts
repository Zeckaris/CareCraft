/**
 * attendance.controller.ts
 *
 * Handles daily attendance for a section, taken by the homeroom teacher.
 *
 * Routes (registered under /api/attendance):
 *   POST   /section/:sectionId/date/:date        – upsert whole-section attendance
 *   GET    /section/:sectionId/date/:date        – roster with statuses for a date
 *   GET    /student/:studentId                   – student attendance over a date range
 *   GET    /section/:sectionId                   – section attendance over a date range
 *   GET    /student/:studentId/summary           – summary per student
 *   GET    /section/:sectionId/summary           – summary per section
 *
 * Correction-window constant (easily changed):
 *   HOMEROOM_CORRECTION_DAYS = 7 – homeroom teachers may correct within 7 calendar
 *   days of the attendance date. Admin/coordinator may correct any time.
 */

import { Response } from 'express'
import mongoose, { Types } from 'mongoose'
import { AuthRequest } from '../middlewares/auth.middleware.js'
import { Attendance } from '../models/attendance.model.js'
import { Student } from '../models/student.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { Section } from '../models/section.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import { AcademicTerm } from '../models/academicTerm.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { logAudit } from '../utils/auditLogger.util.js'
import { queues } from '../redis/queueManager.js'
import {
  validateAttendanceDate,
  todayEAT,
} from '../service/attendanceDateValidator.js'
import { getYearVariants } from '../utils/yearNormalizer.js'
import { AttendanceStatus } from '../types/attendance.type.js'

// ── Constant: correction window for homeroom teachers ────────────────────────
/** Number of calendar days after which a homeroom teacher can no longer edit. */
const HOMEROOM_CORRECTION_DAYS = 7

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the homeroom teaching assignment for a given sectionId and teacherId,
 * or null if none.
 */
async function getHomeroomAssignment(teacherId: string, sectionId: string) {
  return TeachingAssignment.findOne({ teacherId, sectionId, role: 'homeroom' }).lean()
}

/**
 * Returns any assignment (homeroom or subject) for a teacher in the section.
 */
async function getAnyAssignment(teacherId: string, sectionId: string) {
  return TeachingAssignment.findOne({ teacherId, sectionId }).lean()
}

/**
 * Converts a YYYY-MM-DD string to a JS Date at noon UTC for arithmetic.
 */
function parseDateString(dateStr: string): Date {
  const [yr, mo, dy] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(yr, mo - 1, dy, 12, 0, 0))
}

/**
 * Returns true if the correction is within HOMEROOM_CORRECTION_DAYS of
 * the attendance date.
 */
function isWithinCorrectionWindow(dateStr: string): boolean {
  const now = new Date()
  const attendanceDate = parseDateString(dateStr)
  const diffMs = now.getTime() - attendanceDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays <= HOMEROOM_CORRECTION_DAYS
}

// ─── POST /section/:sectionId/date/:date ─────────────────────────────────────
/**
 * Upsert whole-section attendance for a specific date.
 *
 * Body:
 *   records: Array<{
 *     studentId: string
 *     status: 'present' | 'absent' | 'late' | 'excused'
 *     note?: string
 *   }>
 *
 * Roles: homeroom teacher of the section, admin, coordinator
 *
 * - Validates the date (no future, no holidays, no non-school days, within calendar)
 * - Homeroom teachers can only correct within HOMEROOM_CORRECTION_DAYS
 * - Processes only students with active enrollments in the section
 * - Enqueues an absence-notification job when status changes to 'absent'
 * - Writes to AuditLog for corrections (when a record already existed)
 */
export const upsertSectionAttendance = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { sectionId, date } = req.params
  const user = req.user!

  // ── Validate params ────────────────────────────────────────────────────────
  if (!mongoose.isValidObjectId(sectionId)) {
    sendResponse(res, 400, false, 'Invalid sectionId')
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    sendResponse(res, 400, false, 'date must be in YYYY-MM-DD format')
    return
  }

  // ── Section must exist ─────────────────────────────────────────────────────
  const section = await Section.findById(sectionId).lean()
  if (!section) {
    sendResponse(res, 404, false, 'Section not found')
    return
  }

  // ── Authorization ─────────────────────────────────────────────────────────
  const isAdminOrCoord = ['admin', 'coordinator'].includes(user.role)
  if (!isAdminOrCoord) {
    if (user.role !== 'teacher') {
      sendResponse(res, 403, false, 'Access denied')
      return
    }
    const homeroom = await getHomeroomAssignment(user.id.toString(), sectionId)
    if (!homeroom) {
      sendResponse(
        res,
        403,
        false,
        'Only the homeroom teacher of this section may record attendance'
      )
      return
    }
    // Homeroom teacher: past dates without records can be taken freely;
    // correction window is enforced only when modifying an existing record (see below).
  }

  // ── Date validation ────────────────────────────────────────────────────────
  const dateCheck = await validateAttendanceDate(date, section.schoolYear)
  if (!dateCheck.valid) {
    sendResponse(res, 400, false, dateCheck.error!)
    return
  }
  const schoolYear = dateCheck.calendar!.academicYear

  // ── Parse body ─────────────────────────────────────────────────────────────
  const { records } = req.body
  if (!Array.isArray(records) || records.length === 0) {
    sendResponse(res, 400, false, 'Body must contain a non-empty "records" array')
    return
  }

  const validStatuses: AttendanceStatus[] = ['present', 'absent', 'late', 'excused']
  for (const r of records) {
    if (!mongoose.isValidObjectId(r.studentId)) {
      sendResponse(res, 400, false, `Invalid studentId: ${r.studentId}`)
      return
    }
    if (!validStatuses.includes(r.status)) {
      sendResponse(
        res,
        400,
        false,
        `Invalid status "${r.status}" for studentId ${r.studentId}. Must be one of: ${validStatuses.join(', ')}`
      )
      return
    }
  }

  // ── Load active enrollments in this section ───────────────────────────────
  const activeEnrollments = await StudentEnrollment.find({
    sectionId,
    isActive: true,
  })
    .populate('studentId', 'firstName middleName lastName parentId')
    .lean()

  if (activeEnrollments.length === 0) {
    sendResponse(res, 400, false, 'No active enrollments found for this section')
    return
  }

  // Build a lookup from studentId → enrollment for validation
  const enrollmentByStudent = new Map<string, typeof activeEnrollments[0]>()
  for (const e of activeEnrollments) {
    enrollmentByStudent.set(e.studentId.toString(), e)
  }

  // ── Process upserts ───────────────────────────────────────────────────────
  const markedBy = new Types.ObjectId(user.id.toString())
  const results: {
    studentId: string
    status: string
    action: 'created' | 'updated' | 'skipped'
  }[] = []

  for (const rec of records) {
    const sid = rec.studentId.toString()
    const enrollment = enrollmentByStudent.get(sid)
    if (!enrollment) {
      // Student not actively enrolled in this section – skip silently
      results.push({ studentId: sid, status: rec.status, action: 'skipped' })
      continue
    }

    const filter = {
      enrollmentId: enrollment._id,
      date,
    }
    const existing = await Attendance.findOne(filter).lean()

    if (existing) {
      // ── Correction path ──────────────────────────────────────────────────
      // Correction window applies only when editing an existing record
      if (!isAdminOrCoord && !isWithinCorrectionWindow(date)) {
        sendResponse(
          res,
          403,
          false,
          `Homeroom teachers may only edit existing attendance records within ${HOMEROOM_CORRECTION_DAYS} days of the date`
        )
        return
      }

      const prevStatus = existing.status
      await Attendance.updateOne(filter, {
        $set: {
          status: rec.status,
          note: rec.note ?? existing.note,
          markedBy,
          sectionId: enrollment.sectionId,
          schoolYear,
        },
      })

      // Audit log for every edit/correction
      await logAudit(req, {
        type: 'ATTENDANCE_CORRECTION',
        message: `Attendance corrected for student ${sid} on ${date}: ${prevStatus} → ${rec.status}`,
        action: 'corrected',
        entity: 'Attendance',
        target: existing._id.toString(),
      })

      // Enqueue absence notification only when status *changes to* absent
      if (rec.status === 'absent' && prevStatus !== 'absent') {
        const student = enrollment.studentId as any
        const parentId = student?.parentId?.toString()
        if (parentId) {
          const studentName = [student.firstName, student.middleName, student.lastName]
            .filter(Boolean)
            .join(' ')
          try {
            await queues.absenceNotification.add('absence', {
              attendanceId: existing._id.toString(),
              parentId,
              studentName,
              date,
            })
          } catch (queueErr) {
            console.error('Failed to enqueue absence notification for correction:', queueErr)
          }
        }
      }

      results.push({ studentId: sid, status: rec.status, action: 'updated' })
    } else {
      // ── New record path ───────────────────────────────────────────────────
      const newRecord = await Attendance.create({
        enrollmentId: enrollment._id,
        studentId: new Types.ObjectId(sid),
        sectionId: enrollment.sectionId,
        date,
        status: rec.status,
        note: rec.note ?? '',
        markedBy,
        schoolYear,
      })

      // Enqueue absence notification for new absent records
      if (rec.status === 'absent') {
        const student = enrollment.studentId as any
        const parentId = student?.parentId?.toString()
        if (parentId) {
          const studentName = [student.firstName, student.middleName, student.lastName]
            .filter(Boolean)
            .join(' ')
          try {
            await queues.absenceNotification.add('absence', {
              attendanceId: newRecord._id.toString(),
              parentId,
              studentName,
              date,
            })
          } catch (queueErr) {
            console.error('Failed to enqueue absence notification for new record:', queueErr)
          }
        }
      }

      results.push({ studentId: sid, status: rec.status, action: 'created' })
    }
  }

  sendResponse(res, 200, true, 'Attendance saved successfully', { date, results })
}

// ─── GET /section/:sectionId/date/:date ──────────────────────────────────────
/**
 * Returns the full roster for a section and date, including students not yet
 * marked (status: null).
 *
 * Roles: homeroom teacher, subject teacher assigned to this section, admin, coordinator
 */
export const getSectionAttendanceForDate = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { sectionId, date } = req.params
  const user = req.user!

  if (!mongoose.isValidObjectId(sectionId)) {
    sendResponse(res, 400, false, 'Invalid sectionId')
    return
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    sendResponse(res, 400, false, 'date must be in YYYY-MM-DD format')
    return
  }

  try {
    // ── Authorization ────────────────────────────────────────────────────────
    if (!['admin', 'coordinator'].includes(user.role)) {
      if (user.role !== 'teacher') {
        sendResponse(res, 403, false, 'Access denied')
        return
      }
      const assignment = await getAnyAssignment(user.id.toString(), sectionId)
      if (!assignment) {
        sendResponse(res, 403, false, 'You are not assigned to this section')
        return
      }
    }

    // ── Fetch roster + attendance records in parallel ──────────────────────
    const [enrollments, attendanceRecords] = await Promise.all([
      StudentEnrollment.find({ sectionId, isActive: true })
        .populate('studentId', 'firstName middleName lastName gender profileImage')
        .lean(),
      Attendance.find({ sectionId, date })
        .populate('markedBy', 'firstName lastName')
        .lean(),
    ])

    const attendanceMap = new Map<string, typeof attendanceRecords[0]>()
    for (const a of attendanceRecords) {
      attendanceMap.set(a.studentId.toString(), a)
    }

    const roster = enrollments.map((e) => {
      const student = e.studentId as any
      const att = attendanceMap.get(student._id.toString())
      return {
        studentId: student._id,
        firstName: student.firstName,
        middleName: student.middleName,
        lastName: student.lastName,
        gender: student.gender,
        profileImage: student.profileImage,
        enrollmentId: e._id,
        status: att?.status ?? null,
        note: att?.note ?? null,
        markedBy: att?.markedBy ?? null,
        attendanceId: att?._id ?? null,
      }
    })

    sendResponse(res, 200, true, 'Section attendance fetched successfully', {
      sectionId,
      date,
      total: roster.length,
      marked: attendanceRecords.length,
      roster,
    })
  } catch (err) {
    sendResponse(res, 500, false, 'Server error fetching section attendance', null, err)
  }
}

// ─── GET /student/:studentId ──────────────────────────────────────────────────
/**
 * Returns all attendance records for a student within a date range.
 *
 * Query: from (YYYY-MM-DD), to (YYYY-MM-DD)
 *
 * Roles:
 *   - admin / coordinator: always
 *   - teacher: must be assigned to the student's current section (any role)
 *   - parent: must be the student's own parent
 */
export const getStudentAttendance = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { studentId } = req.params
  const user = req.user!
  const { from, to, schoolYear } = req.query as Record<string, string>

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId')
    return
  }

  try {
    // ── Authorization ────────────────────────────────────────────────────────
    if (!['admin', 'coordinator'].includes(user.role)) {
      if (user.role === 'parent') {
        const student = await Student.findById(studentId).select('parentId').lean()
        if (!student) {
          sendResponse(res, 404, false, 'Student not found')
          return
        }
        if (!student.parentId || student.parentId.toString() !== user.id.toString()) {
          sendResponse(res, 403, false, 'Forbidden: you can only view your own child\'s attendance')
          return
        }
      } else if (user.role === 'teacher') {
        // Teacher must be in the student's section (any role)
        const enrollment = await StudentEnrollment.findOne({
          studentId,
          isActive: true,
        })
          .select('sectionId')
          .lean()
        if (!enrollment?.sectionId) {
          sendResponse(res, 403, false, 'Student has no active section enrollment')
          return
        }
        const assignment = await getAnyAssignment(
          user.id.toString(),
          enrollment.sectionId.toString()
        )
        if (!assignment) {
          sendResponse(res, 403, false, 'You are not assigned to this student\'s section')
          return
        }
      } else {
        sendResponse(res, 403, false, 'Access denied')
        return
      }
    }

    // ── Build query ─────────────────────────────────────────────────────────
    const filter: any = { studentId }
    if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear) }
    if (from) filter.date = { ...(filter.date ?? {}), $gte: from }
    if (to) filter.date = { ...(filter.date ?? {}), $lte: to }

    const records = await Attendance.find(filter)
      .populate('sectionId', 'name')
      .populate('markedBy', 'firstName lastName')
      .sort({ date: 1 })
      .lean()

    sendResponse(res, 200, true, 'Student attendance fetched', records)
  } catch (err) {
    sendResponse(res, 500, false, 'Server error fetching student attendance', null, err)
  }
}

// ─── GET /section/:sectionId ──────────────────────────────────────────────────
/**
 * Returns attendance records for an entire section within a date range.
 *
 * Query: from (YYYY-MM-DD), to (YYYY-MM-DD), schoolYear
 *
 * Roles: homeroom / subject teacher in section, admin, coordinator
 */
export const getSectionAttendanceRange = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { sectionId } = req.params
  const user = req.user!
  const { from, to, schoolYear } = req.query as Record<string, string>

  if (!mongoose.isValidObjectId(sectionId)) {
    sendResponse(res, 400, false, 'Invalid sectionId')
    return
  }

  try {
    // ── Authorization ────────────────────────────────────────────────────────
    if (!['admin', 'coordinator'].includes(user.role)) {
      if (user.role !== 'teacher') {
        sendResponse(res, 403, false, 'Access denied')
        return
      }
      const assignment = await getAnyAssignment(user.id.toString(), sectionId)
      if (!assignment) {
        sendResponse(res, 403, false, 'You are not assigned to this section')
        return
      }
    }

    const filter: any = { sectionId }
    if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear) }
    if (from) filter.date = { ...(filter.date ?? {}), $gte: from }
    if (to) filter.date = { ...(filter.date ?? {}), $lte: to }

    const records = await Attendance.find(filter)
      .populate('studentId', 'firstName middleName lastName')
      .populate('markedBy', 'firstName lastName')
      .sort({ date: 1, studentId: 1 })
      .lean()

    sendResponse(res, 200, true, 'Section attendance range fetched', records)
  } catch (err) {
    sendResponse(res, 500, false, 'Server error fetching section attendance range', null, err)
  }
}

// ─── GET /student/:studentId/summary ─────────────────────────────────────────
/**
 * Returns attendance summary (counts per status + rate) for a student.
 *
 * Query: schoolYear (e.g. "2024-2025"), termId, from, to
 *   - If termId is given, from/to are derived from the term.
 *   - Otherwise uses from/to or full schoolYear.
 *
 * Roles: same as getStudentAttendance
 */
export const getStudentAttendanceSummary = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { studentId } = req.params
  const user = req.user!
  const { schoolYear, termId, from, to } = req.query as Record<string, string>

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId')
    return
  }

  try {
    // ── Authorization (same as getStudentAttendance) ──────────────────────
    if (!['admin', 'coordinator'].includes(user.role)) {
      if (user.role === 'parent') {
        const student = await Student.findById(studentId).select('parentId').lean()
        if (!student) {
          sendResponse(res, 404, false, 'Student not found')
          return
        }
        if (!student.parentId || student.parentId.toString() !== user.id.toString()) {
          sendResponse(res, 403, false, 'Forbidden: you can only view your own child\'s attendance')
          return
        }
      } else if (user.role === 'teacher') {
        const enrollment = await StudentEnrollment.findOne({ studentId, isActive: true })
          .select('sectionId')
          .lean()
        if (!enrollment?.sectionId) {
          sendResponse(res, 403, false, 'Student has no active section enrollment')
          return
        }
        const assignment = await getAnyAssignment(
          user.id.toString(),
          enrollment.sectionId.toString()
        )
        if (!assignment) {
          sendResponse(res, 403, false, 'You are not assigned to this student\'s section')
          return
        }
      } else {
        sendResponse(res, 403, false, 'Access denied')
        return
      }
    }

    const filter: any = { studentId }
    await applyDateRangeFilter(filter, schoolYear, termId, from, to)

    const summary = await buildSummary(filter)
    sendResponse(res, 200, true, 'Student attendance summary fetched', { studentId, ...summary })
  } catch (err) {
    sendResponse(res, 500, false, 'Server error fetching student attendance summary', null, err)
  }
}

// ─── GET /section/:sectionId/summary ─────────────────────────────────────────
/**
 * Returns per-student attendance summary for a section.
 *
 * Query: schoolYear, termId, from, to
 *
 * Roles: homeroom / subject teacher in section, admin, coordinator
 */
export const getSectionAttendanceSummary = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { sectionId } = req.params
  const user = req.user!
  const { schoolYear, termId, from, to } = req.query as Record<string, string>

  if (!mongoose.isValidObjectId(sectionId)) {
    sendResponse(res, 400, false, 'Invalid sectionId')
    return
  }

  try {
    // ── Authorization ────────────────────────────────────────────────────────
    if (!['admin', 'coordinator'].includes(user.role)) {
      if (user.role !== 'teacher') {
        sendResponse(res, 403, false, 'Access denied')
        return
      }
      const assignment = await getAnyAssignment(user.id.toString(), sectionId)
      if (!assignment) {
        sendResponse(res, 403, false, 'You are not assigned to this section')
        return
      }
    }

    const baseFilter: any = { sectionId }
    await applyDateRangeFilter(baseFilter, schoolYear, termId, from, to)

    // Per-student aggregate
    const agg = await Attendance.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: '$studentId',
          present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'students',
          localField: '_id',
          foreignField: '_id',
          as: 'student',
          pipeline: [{ $project: { firstName: 1, middleName: 1, lastName: 1 } }],
        },
      },
      { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
      { $sort: { 'student.lastName': 1 } },
    ])

    const rows = agg.map((r) => ({
      studentId: r._id,
      firstName: r.student?.firstName,
      middleName: r.student?.middleName,
      lastName: r.student?.lastName,
      present: r.present,
      absent: r.absent,
      late: r.late,
      excused: r.excused,
      total: r.total,
      attendanceRate: r.total > 0 ? ((r.present + r.late) / r.total) * 100 : null,
    }))

    sendResponse(res, 200, true, 'Section attendance summary fetched', { sectionId, rows })
  } catch (err) {
    sendResponse(res, 500, false, 'Server error fetching section attendance summary', null, err)
  }
}

// ─── private helpers ──────────────────────────────────────────────────────────

/**
 * Builds a status-count + attendance-rate summary from a Mongoose filter.
 */
async function buildSummary(filter: any) {
  const agg = await Attendance.aggregate([
    { $match: filter },
    {
      $group: {
        _id: null,
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
        excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
  ])

  if (agg.length === 0) {
    return { present: 0, absent: 0, late: 0, excused: 0, total: 0, attendanceRate: null }
  }
  const r = agg[0]
  return {
    present: r.present,
    absent: r.absent,
    late: r.late,
    excused: r.excused,
    total: r.total,
    // present + late counts toward attendance rate (late but present)
    attendanceRate: r.total > 0 ? ((r.present + r.late) / r.total) * 100 : null,
  }
}

/**
 * Mutates `filter` to add date-range constraints derived from
 * schoolYear / termId / explicit from-to.
 * Priority: termId > from/to > schoolYear.
 */
async function applyDateRangeFilter(
  filter: any,
  schoolYear?: string,
  termId?: string,
  from?: string,
  to?: string
): Promise<void> {
  if (termId && mongoose.isValidObjectId(termId)) {
    const term = await AcademicTerm.findById(termId).lean()
    if (term) {
      const startStr = term.startDate
        ? term.startDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Addis_Ababa' })
        : undefined
      const endStr = term.endDate
        ? term.endDate.toLocaleDateString('en-CA', { timeZone: 'Africa/Addis_Ababa' })
        : undefined
      if (startStr) filter.date = { ...(filter.date ?? {}), $gte: startStr }
      if (endStr) filter.date = { ...(filter.date ?? {}), $lte: endStr }
      return
    }
  }

  if (from || to) {
    if (from) filter.date = { ...(filter.date ?? {}), $gte: from }
    if (to) filter.date = { ...(filter.date ?? {}), $lte: to }
    return
  }

  if (schoolYear) {
    filter.schoolYear = { $in: getYearVariants(schoolYear) }
  }
}
