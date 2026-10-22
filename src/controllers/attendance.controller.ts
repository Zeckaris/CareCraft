/**
 * attendance.controller.ts
 *
 * Handles daily attendance for a section, taken by the homeroom teacher.
 *
 * Routes (registered under /api/attendance):
 *   POST   /section/:sectionId/date/:date        – upsert whole-section attendance;
 *                                                  validate-first with per-record
 *                                                  outcomes (created | updated |
 *                                                  unchanged | skipped | conflict |
 *                                                  rejected) and optional optimistic
 *                                                  concurrency via records[].expectedUpdatedAt
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
import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { calculateAttendanceRate } from '../utils/attendanceRate.util.js'
import { logAudit } from '../utils/auditLogger.util.js'
import { queues } from '../redis/queueManager.js'
import { validateAttendanceDate } from '../service/attendanceDateValidator.js'
import { enqueueStudentBadgeEvaluations } from '../service/badgeEvaluationQueue.service.js'
import { loadSchoolDayContext } from '../service/schoolDay.service.js'
import { getYearVariants, normalizeYear, yearsMatch } from '../utils/yearNormalizer.js'
import { isSchoolDateString, toSchoolDateString } from '../utils/schoolDate.util.js'
import { sortByStudentName } from '../utils/studentSort.util.js'
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

// ─── per-record outcome types & helpers (offline-queue support) ──────────────

interface SubmissionRecord {
  studentId: string
  status: AttendanceStatus
  /** Omitted → keep existing note on update; '' → clear the note. */
  note?: string
  /**
   * Optimistic-concurrency token.
   *   absent (undefined) → no expectation, behaves as today (last write wins)
   *   null               → client believes NO record exists
   *   ISO string         → must equal the stored record's updatedAt
   */
  expectedUpdatedAt?: string | null
}

type RecordAction = 'created' | 'updated' | 'unchanged' | 'skipped' | 'conflict' | 'rejected'

interface StoredSnapshot {
  status: AttendanceStatus
  note: string
  updatedAt: Date | null
  markedBy: any
}

interface RecordOutcome {
  studentId: string
  status: AttendanceStatus
  action: RecordAction
  reason?: string
  /** Only present on conflicts: the current stored values. */
  stored?: StoredSnapshot | null
}

function storedSnapshot(doc: any): StoredSnapshot {
  return {
    status: doc?.status,
    note: doc?.note ?? '',
    updatedAt: doc?.updatedAt ?? null,
    markedBy: doc?.markedBy ?? null,
  }
}

function conflictOutcome(
  rec: SubmissionRecord,
  reason: string,
  snapshot: StoredSnapshot | null
): RecordOutcome {
  return {
    studentId: rec.studentId.toString(),
    status: rec.status,
    action: 'conflict',
    reason,
    stored: snapshot,
  }
}

/**
 * Decides what should happen to a submitted record when a stored record exists.
 * Pure (no I/O) so it can be reused in the planning pass and on race recovery.
 */
function decideAgainstExisting(
  rec: SubmissionRecord,
  existing: any,
  isAdminOrCoord: boolean,
  date: string
): { type: 'conflict' | 'unchanged' | 'rejected' | 'update'; reason?: string } {
  // Optimistic-concurrency check. Records without an expectation behave as today.
  if (rec.expectedUpdatedAt !== undefined) {
    if (rec.expectedUpdatedAt === null) {
      return { type: 'conflict', reason: 'A record already exists but the client expected none' }
    }
    const expected = new Date(rec.expectedUpdatedAt)
    const actual = existing?.updatedAt ? new Date(existing.updatedAt).getTime() : null
    if (
      Number.isNaN(expected.getTime()) ||
      actual === null ||
      expected.getTime() !== actual
    ) {
      return {
        type: 'conflict',
        reason: 'expectedUpdatedAt does not match the stored record; it was changed by another user',
      }
    }
  }

  // No-op detection: identical status and (effective) note must not rewrite.
  const submittedNote = rec.note === undefined ? (existing?.note ?? '') : rec.note
  if (
    rec.status === existing?.status &&
    String(submittedNote ?? '').trim() === String(existing?.note ?? '').trim()
  ) {
    return { type: 'unchanged' }
  }

  // Correction window applies only when editing an existing record.
  if (!isAdminOrCoord && !isWithinCorrectionWindow(date)) {
    return {
      type: 'rejected',
      reason: `Homeroom teachers may only edit existing attendance records within ${HOMEROOM_CORRECTION_DAYS} days of the date`,
    }
  }

  return { type: 'update' }
}

/**
 * Enqueues the parent notification for an absence. Never throws – a queue
 * failure must not fail the attendance save.
 */
function enrollmentStudentName(enrollment: any): string {
  const student = enrollment?.studentId as any
  return (
    [student?.firstName, student?.middleName, student?.lastName]
      .filter(Boolean)
      .join(' ') || 'Unknown student'
  )
}

async function enqueueAbsenceNotification(
  attendanceId: string,
  enrollment: any,
  date: string
): Promise<void> {
  const student = enrollment.studentId as any
  const parentId = student?.parentId?.toString()
  if (!parentId) return
  const studentName = [student.firstName, student.middleName, student.lastName]
    .filter(Boolean)
    .join(' ')
  try {
    await queues.absenceNotification.add('absence', {
      attendanceId,
      parentId,
      studentName,
      date,
    })
  } catch (queueErr) {
    console.error('Failed to enqueue absence notification:', queueErr)
  }
}

// ─── POST /section/:sectionId/date/:date ─────────────────────────────────────
/**
 * Upsert whole-section attendance for a specific date (offline-queue friendly).
 *
 * Body:
 *   records: Array<{
 *     studentId: string
 *     status: 'present' | 'absent' | 'late' | 'excused'
 *     note?: string                     // omitted → keep existing; '' → clear
 *     expectedUpdatedAt?: string | null // optional optimistic-concurrency token
 *   }>
 *
 * Validate-first: every record is checked (enrollment, update-vs-create,
 * correction window, optimistic-concurrency expectation) against the DB before
 * any write, and the write loop never aborts mid-batch. Each record gets a
 * per-record outcome:
 *   created | updated | unchanged | skipped | conflict | rejected
 *
 * All-new (optional) request fields: records[].expectedUpdatedAt.
 * Records without it behave exactly as before (last write wins).
 *
 * Roles: homeroom teacher of the section, admin, coordinator
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
  const schoolYear = normalizeYear(dateCheck.calendar!.academicYear)
  const academicTermId = dateCheck.term?._id ?? null

  // ── Parse body ─────────────────────────────────────────────────────────────
  const { records } = (req.body ?? {}) as { records?: SubmissionRecord[] }
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
    if (
      r.expectedUpdatedAt !== undefined &&
      r.expectedUpdatedAt !== null &&
      (typeof r.expectedUpdatedAt !== 'string' ||
        Number.isNaN(new Date(r.expectedUpdatedAt).getTime()))
    ) {
      sendResponse(res, 400, false, 'expectedUpdatedAt must be null or an ISO date string')
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

  // Build a lookup from studentId → enrollment for validation.
  // studentId is populated + lean, so it is an object with its own _id;
  // reading it directly must use that _id (a plain object's toString() would
  // yield "[object Object]" and never match a submitted studentId string).
  const enrollmentByStudent = new Map<string, any>()
  for (const e of activeEnrollments) {
    enrollmentByStudent.set(String(e.studentId?._id ?? e.studentId), e)
  }

  // ── Load existing records for this date in a single query ─────────────────
  const recordEnrollmentIds = [
    ...new Set(
      records
        .map((r) => enrollmentByStudent.get(r.studentId.toString())?._id?.toString())
        .filter((x): x is string => Boolean(x))
    ),
  ]
  const existingByEnrollment = new Map<string, any>()
  if (recordEnrollmentIds.length > 0) {
    const existingDocs = await Attendance.find({
      enrollmentId: { $in: recordEnrollmentIds },
      date,
    })
      .populate('markedBy', 'firstName lastName')
      .lean()
    for (const doc of existingDocs) {
      existingByEnrollment.set(String(doc.enrollmentId), doc)
    }
  }

  // ── Plan phase: decide every record against DB state; no writes yet ────────
  const markedBy = new Types.ObjectId(user.id.toString())
  const results: RecordOutcome[] = new Array(records.length)

  interface PendingWrite {
    index: number
    rec: SubmissionRecord
    enrollment: any
    kind: 'create' | 'update'
    existing: any
  }
  const pendingWrites: PendingWrite[] = []

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const sid = rec.studentId.toString()
    const enrollment = enrollmentByStudent.get(sid)
    if (!enrollment) {
      // Student not actively enrolled in this section – skip, never abort
      results[i] = {
        studentId: sid,
        status: rec.status,
        action: 'skipped',
        reason: 'Student is not actively enrolled in this section',
      }
      continue
    }

    const existing = existingByEnrollment.get(enrollment._id.toString()) ?? null
    if (existing) {
      const decision = decideAgainstExisting(rec, existing, isAdminOrCoord, date)
      if (decision.type === 'conflict') {
        results[i] = conflictOutcome(rec, decision.reason!, storedSnapshot(existing))
        continue
      }
      if (decision.type === 'unchanged') {
        results[i] = { studentId: sid, status: rec.status, action: 'unchanged' }
        continue
      }
      if (decision.type === 'rejected') {
        results[i] = {
          studentId: sid,
          status: rec.status,
          action: 'rejected',
          reason: decision.reason,
        }
        continue
      }
      pendingWrites.push({ index: i, rec, enrollment, kind: 'update', existing })
    } else {
      // Client expected a record but none exists – conflict, not a silent create.
      if (typeof rec.expectedUpdatedAt === 'string') {
        results[i] = conflictOutcome(
          rec,
          'No stored record exists but a non-null expectedUpdatedAt was provided',
          null
        )
        continue
      }
      pendingWrites.push({ index: i, rec, enrollment, kind: 'create', existing: null })
    }
  }

  // ── Write phase: only planned records, per-record try/catch, never aborts ──
  const buildAttendanceUpdate = (rec: SubmissionRecord, existingNote: string | undefined, enrollment: any) => ({
    $set: {
      status: rec.status,
      note: rec.note === undefined ? existingNote : rec.note,
      markedBy,
      sectionId: enrollment.sectionId,
      schoolYear,
      academicTermId,
    },
  })

  const applyUpdate = async (
    rec: SubmissionRecord,
    snapshot: any,
    enrollment: any
  ): Promise<RecordOutcome> => {
    await Attendance.updateOne(
      { enrollmentId: enrollment._id, date },
      buildAttendanceUpdate(rec, snapshot.note, enrollment)
    )
    await logAudit(req, {
      type: 'ATTENDANCE_CORRECTION',
      message: `Attendance corrected for ${enrollmentStudentName(enrollment)} on ${date}: ${snapshot.status} → ${rec.status}`,
      action: 'corrected',
      entity: 'Attendance',
      target: snapshot._id.toString(),
    })
    if (rec.status === 'absent' && snapshot.status !== 'absent') {
      await enqueueAbsenceNotification(snapshot._id.toString(), enrollment, date)
    }
    return { studentId: rec.studentId.toString(), status: rec.status, action: 'updated' }
  }

  const attemptCreate = async (pw: PendingWrite): Promise<RecordOutcome> => {
    const { rec } = pw
    try {
      const newRecord = await Attendance.create({
        enrollmentId: pw.enrollment._id,
        studentId: new Types.ObjectId(rec.studentId.toString()),
        sectionId: pw.enrollment.sectionId,
        date,
        status: rec.status,
        note: rec.note ?? '',
        markedBy,
        schoolYear,
        academicTermId,
      })
      if (rec.status === 'absent') {
        await enqueueAbsenceNotification(newRecord._id.toString(), pw.enrollment, date)
      }
      return { studentId: rec.studentId.toString(), status: rec.status, action: 'created' }
    } catch (err: any) {
      // Duplicate key = another writer created this record first; treat as
      // an existing record rather than a 500.
      if (err?.code !== 11000) throw err
      return recoverRace(pw)
    }
  }

  const recoverRace = async (pw: PendingWrite): Promise<RecordOutcome> => {
    const raced = await Attendance.findOne({
      enrollmentId: pw.enrollment._id,
      date,
    })
      .populate('markedBy', 'firstName lastName')
      .lean()
    if (!raced) return attemptCreate(pw)
    const decision = decideAgainstExisting(pw.rec, raced, isAdminOrCoord, date)
    if (decision.type === 'conflict') {
      return conflictOutcome(pw.rec, decision.reason!, storedSnapshot(raced))
    }
    if (decision.type === 'unchanged') {
      return { studentId: pw.rec.studentId.toString(), status: pw.rec.status, action: 'unchanged' }
    }
    if (decision.type === 'rejected') {
      return {
        studentId: pw.rec.studentId.toString(),
        status: pw.rec.status,
        action: 'rejected',
        reason: decision.reason,
      }
    }
    return applyUpdate(pw.rec, raced, pw.enrollment)
  }

  for (const pw of pendingWrites) {
    const sid = pw.rec.studentId.toString()
    try {
      if (pw.kind === 'update') {
        const upd = await Attendance.updateOne(
          { enrollmentId: pw.enrollment._id, date },
          buildAttendanceUpdate(pw.rec, pw.existing.note, pw.enrollment)
        )
        if (upd.matchedCount === 0) {
          // Record was deleted under us by a concurrent writer – re-decide.
          results[pw.index] = await recoverRace(pw)
          continue
        }
        await logAudit(req, {
          type: 'ATTENDANCE_CORRECTION',
          message: `Attendance corrected for ${enrollmentStudentName(pw.enrollment)} on ${date}: ${pw.existing.status} → ${pw.rec.status}`,
          action: 'corrected',
          entity: 'Attendance',
          target: pw.existing._id.toString(),
        })
        if (pw.rec.status === 'absent' && pw.existing.status !== 'absent') {
          await enqueueAbsenceNotification(pw.existing._id.toString(), pw.enrollment, date)
        }
        results[pw.index] = { studentId: sid, status: pw.rec.status, action: 'updated' }
      } else {
        results[pw.index] = await attemptCreate(pw)
      }
    } catch (err) {
      results[pw.index] = {
        studentId: sid,
        status: pw.rec.status,
        action: 'rejected',
        reason: `Server error while saving record: ${(err as Error)?.message ?? 'unknown error'}`,
      }
    }
  }

  const changedStudentIds = results
    .filter((result) => result && ['created', 'updated'].includes(result.action))
    .map((result) => result.studentId)
  await enqueueStudentBadgeEvaluations(changedStudentIds)

  sendResponse(res, 200, true, 'Attendance saved successfully', { date, results })
}

// ─── GET /school-day ─────────────────────────────────────────────────────────
export const getSchoolDay = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { date, schoolYear } = req.query as Record<string, unknown>

  if (date !== undefined && (typeof date !== 'string' || !isSchoolDateString(date))) {
    sendResponse(res, 400, false, 'date must be a valid YYYY-MM-DD date')
    return
  }

  if (schoolYear !== undefined && typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'schoolYear must be a string')
    return
  }

  const requestedYear = typeof schoolYear === 'string' ? schoolYear.trim() : undefined
  if (requestedYear !== undefined && !/^\d{4}-(\d{4}|\d{2})$/.test(requestedYear)) {
    sendResponse(res, 400, false, 'schoolYear must be in YYYY-YYYY or YYYY-YY format')
    return
  }

  try {
    const loaded = await loadSchoolDayContext(requestedYear)
    if (!loaded.ok) {
      sendResponse(res, loaded.status, false, loaded.message)
      return
    }

    const { context } = loaded
    const resolvedDate = typeof date === 'string' ? date : context.today
    const outcome = context.isSchoolDay(resolvedDate)

    sendResponse(res, 200, true, 'School day status fetched successfully', {
      date: resolvedDate,
      schoolYear: context.schoolYear,
      isSchoolDay: outcome.isSchoolDay,
      reason: outcome.reason,
      academicTermId: outcome.academicTermId,
    })
  } catch (err) {
    sendResponse(res, 500, false, 'Server error fetching school day status', null, err)
  }
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

    const roster = sortByStudentName(
      enrollments.map((e) => {
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
          // Optimistic-concurrency token for the take endpoint (expectedUpdatedAt).
          updatedAt: att?.updatedAt ?? null,
        }
      })
    )

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

    const enrollment = await StudentEnrollment.findOne({ studentId, isActive: true })
      .select('schoolYear')
      .lean()
    const expectedSchoolYear = schoolYear || enrollment?.schoolYear

    let term: any = null
    if (termId) {
      const resolved = await resolveSummaryTerm(termId, expectedSchoolYear)
      if (resolved.error) {
        sendResponse(res, resolved.error.status, false, resolved.error.message)
        return
      }
      term = resolved.term
    }

    const filter: any = { studentId }
    applyDateRangeFilter(filter, schoolYear, term, from, to)

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

    const section = await Section.findById(sectionId).select('schoolYear').lean()
    if (!section) {
      sendResponse(res, 404, false, 'Section not found')
      return
    }

    let term: any = null
    if (termId) {
      const resolved = await resolveSummaryTerm(termId, section.schoolYear)
      if (resolved.error) {
        sendResponse(res, resolved.error.status, false, resolved.error.message)
        return
      }
      term = resolved.term
    }

    const baseFilter: any = { sectionId }
    applyDateRangeFilter(baseFilter, schoolYear, term, from, to)

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
    ])

    const rows = sortByStudentName(
      agg.map((r) => ({
        studentId: r._id,
        firstName: r.student?.firstName,
        middleName: r.student?.middleName,
        lastName: r.student?.lastName,
        present: r.present,
        absent: r.absent,
        late: r.late,
        excused: r.excused,
        total: r.total,
        attendanceRate: calculateAttendanceRate(r),
      }))
    )

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
    // Excused absences are excluded from the denominator (see shared util).
    attendanceRate: calculateAttendanceRate(r),
  }
}

/**
 * Validates a term supplied to a summary endpoint. The term must exist, its
 * calendar must exist, and (when known) its school year must match the
 * student's/section's school year.
 */
async function resolveSummaryTerm(
  termId: string,
  expectedSchoolYear?: string
): Promise<{ term?: any; error?: { status: number; message: string } }> {
  if (!mongoose.isValidObjectId(termId)) {
    return { error: { status: 400, message: 'Invalid termId' } }
  }
  const term = await AcademicTerm.findById(termId).lean()
  if (!term) {
    return { error: { status: 400, message: 'Academic term not found' } }
  }
  const termStart = toSchoolDateString(term.startDate)
  const termEnd = toSchoolDateString(term.endDate)
  if (!termStart || !termEnd) {
    return { error: { status: 400, message: 'Academic term has invalid start or end dates' } }
  }
  const calendar = await AcademicCalendar.findById(term.calendarId).lean()
  if (!calendar) {
    return { error: { status: 400, message: 'Academic calendar for term not found' } }
  }
  if (expectedSchoolYear && !yearsMatch(calendar.academicYear, expectedSchoolYear)) {
    return {
      error: {
        status: 400,
        message: `Term "${term.name}" belongs to ${calendar.academicYear}, but this section is for ${expectedSchoolYear}`,
      },
    }
  }
  return { term }
}

/**
 * Mutates `filter` to add date-range constraints derived from
 * schoolYear / a validated term / explicit from-to.
 * Priority: term > from/to > schoolYear.
 */
function applyDateRangeFilter(
  filter: any,
  schoolYear?: string,
  term?: any,
  from?: string,
  to?: string
): void {
  if (term) {
    const startStr = toSchoolDateString(term.startDate)
    const endStr = toSchoolDateString(term.endDate)
    if (startStr) filter.date = { ...(filter.date ?? {}), $gte: startStr }
    if (endStr) filter.date = { ...(filter.date ?? {}), $lte: endStr }
    return
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
