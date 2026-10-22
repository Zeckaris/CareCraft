/**
 * access.middleware.ts
 *
 * Reusable helpers and Express middleware for role-based access scoping.
 *
 * ROLES
 *  - admin / coordinator: full access everywhere
 *  - teacher (homeroom): may write evaluations, action plans, badges and
 *    observations for students in their section.
 *  - teacher (subject): may create observations for students in their sections;
 *    edit/delete only their own; read-only for other writes.
 *  - parent: may only access their own child's data.
 *
 * HELPERS EXPORTED
 *  getStudentSectionId(studentId, schoolYear?) – resolves the section of a
 *    student's active enrollment (or the matching historical one).
 *
 *  getTeacherSectionIds(teacherId, schoolYear?) – returns all sectionIds the
 *    teacher is assigned to in the given year.
 *
 *  assertTeacherCanReadStudent(teacherId, studentId) – throws 403 if teacher
 *    has no assignment to the student's section.
 *
 *  assertTeacherCanWriteStudent(teacherId, studentId, writeRole?) – checks
 *    homeroom write access.
 *
 *  assertParentOwnsStudent(parentId, studentId) – throws 403 if student's
 *    parentId !== parentId.
 *
 * MIDDLEWARE EXPORTED
 *  scopeStudentAccess – attaches helpers to res.locals; for parent role
 *    verifies parentId ownership; for teacher role verifies section membership.
 *    Designed to be re-used across observations, evaluations, action plans,
 *    badges, assessment scores, and enrollments.
 *
 *  resolveTeacherId(req) – returns the effective teacherId:
 *    - admin/coordinator: uses explicit body teacherId if provided, else req.user.id
 *    - teacher/parent: always req.user.id (body teacherId is ignored)
 */

import { Request, Response, NextFunction } from 'express'
import mongoose, { Types } from 'mongoose'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { Student } from '../models/student.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { AuthRequest } from './auth.middleware.js'
import { getYearVariants } from '../utils/yearNormalizer.js'

// ─── low-level helpers ───────────────────────────────────────────────────────

/**
 * Returns the sectionId for a student's active enrollment.
 * If schoolYear is supplied it finds the enrollment for that year instead.
 */
export async function getStudentSectionId(
  studentId: string | Types.ObjectId,
  schoolYear?: string
): Promise<Types.ObjectId | null> {
  const filter: any = { studentId }
  if (schoolYear) {
    filter.schoolYear = { $in: getYearVariants(schoolYear) }
  } else {
    filter.isActive = true
  }
  const enrollment = await StudentEnrollment.findOne(filter)
    .select('sectionId')
    .lean()
  if (!enrollment || !enrollment.sectionId) return null
  return enrollment.sectionId as Types.ObjectId
}

/**
 * Returns all sectionIds the teacher is assigned to (any role) optionally
 * filtered by school year.
 */
export async function getTeacherSectionIds(
  teacherId: string | Types.ObjectId,
  schoolYear?: string
): Promise<Types.ObjectId[]> {
  const filter: any = { teacherId }
  if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear) }
  const assignments = await TeachingAssignment.find(filter).select('sectionId').lean()
  return assignments.map((a) => a.sectionId as Types.ObjectId)
}

/**
 * Returns all section assignments for a teacher (full objects so callers can
 * inspect role and subjectId).
 */
export async function getTeacherAssignments(
  teacherId: string | Types.ObjectId,
  schoolYear?: string
) {
  const filter: any = { teacherId }
  if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear) }
  return TeachingAssignment.find(filter).lean()
}

/**
 * Checks whether teacherId has any assignment to the student's current
 * section. Returns the matching assignment or null.
 */
export async function getAssignmentForStudentSection(
  teacherId: string | Types.ObjectId,
  studentId: string | Types.ObjectId
) {
  const sectionId = await getStudentSectionId(studentId)
  if (!sectionId) return null
  return TeachingAssignment.findOne({ teacherId, sectionId }).lean()
}

/**
 * Returns true if teacher has a homeroom assignment for the student's section.
 */
export async function isHomeroomForStudent(
  teacherId: string | Types.ObjectId,
  studentId: string | Types.ObjectId
): Promise<boolean> {
  const sectionId = await getStudentSectionId(studentId)
  if (!sectionId) return false
  const assignment = await TeachingAssignment.findOne({
    teacherId,
    sectionId,
    role: 'homeroom',
  }).lean()
  return !!assignment
}

/**
 * Resolves the effective teacherId for a mutation request.
 *  - admin / coordinator: may pass explicit teacherId in body (entering on
 *    someone's behalf). Falls back to req.user.id.
 *  - teacher / parent / any other role: always req.user.id.
 */
export function resolveTeacherId(req: AuthRequest): string {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role) && req.body?.teacherId) {
    return req.body.teacherId as string
  }
  return user.id as string
}

// ─── assertion helpers (throw on violation) ──────────────────────────────────

/**
 * Verifies that a parent owns the requested student.
 * Throws a structured 403 error object that middleware can catch.
 */
export async function assertParentOwnsStudent(
  parentId: string | Types.ObjectId,
  studentId: string | Types.ObjectId
): Promise<void> {
  const student = await Student.findById(studentId).select('parentId').lean()
  if (!student) {
    const e: any = new Error('Student not found')
    e.statusCode = 404
    throw e
  }
  if (!student.parentId || student.parentId.toString() !== parentId.toString()) {
    const e: any = new Error('Forbidden: You can only access your own child\'s data')
    e.statusCode = 403
    throw e
  }
}

/**
 * Verifies that a teacher can read data for the given student (any role in
 * the student's section).
 */
export async function assertTeacherCanReadStudent(
  teacherId: string | Types.ObjectId,
  studentId: string | Types.ObjectId
): Promise<void> {
  const assignment = await getAssignmentForStudentSection(teacherId, studentId)
  if (!assignment) {
    const e: any = new Error('Forbidden: You are not assigned to this student\'s section')
    e.statusCode = 403
    throw e
  }
}

/**
 * Verifies that a teacher can write evaluations/action-plans/badges for the
 * student (homeroom role only).
 */
export async function assertTeacherCanWriteStudent(
  teacherId: string | Types.ObjectId,
  studentId: string | Types.ObjectId
): Promise<void> {
  const ok = await isHomeroomForStudent(teacherId, studentId)
  if (!ok) {
    const e: any = new Error(
      'Forbidden: Only the homeroom teacher can create evaluations, action plans and badges for this student'
    )
    e.statusCode = 403
    throw e
  }
}

// ─── Express middleware ──────────────────────────────────────────────────────

/**
 * requireStudentAccess(writeLevel?)
 *
 * Middleware factory for routes that act on a single student identified by
 * req.params.studentId or req.body.studentId.
 *
 * writeLevel:
 *   'read'     – teacher must be in student's section (any role)
 *   'homeroom' – teacher must be homeroom of student's section
 *   undefined  – no teacher write check (read or admin-only write path)
 *
 * For parents: always checks parentId ownership.
 * For admin/coordinator: passes through immediately.
 *
 * Usage:
 *   router.post('/', authMiddleware, requireStudentAccess('homeroom'), createObservation)
 */
export function requireStudentAccess(writeLevel?: 'read' | 'homeroom') {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!
      const role = user.role

      // admin/coordinator: always allowed
      if (['admin', 'coordinator'].includes(role)) {
        return next()
      }

      // Determine studentId from params or body
      const studentId = req.params.studentId || req.body?.studentId
      if (!studentId || !mongoose.isValidObjectId(studentId)) {
        // No studentId to check yet – let the controller handle validation
        return next()
      }

      if (role === 'parent') {
        await assertParentOwnsStudent(user.id, studentId)
        return next()
      }

      if (role === 'teacher') {
        if (writeLevel === 'homeroom') {
          await assertTeacherCanWriteStudent(user.id, studentId)
        } else {
          await assertTeacherCanReadStudent(user.id, studentId)
        }
        return next()
      }

      // Any other role: deny
      sendResponse(res, 403, false, 'Access denied')
    } catch (err: any) {
      sendResponse(
        res,
        err.statusCode || 500,
        false,
        err.message || 'Server error checking access'
      )
    }
  }
}

/**
 * requireParentOwnsStudent
 *
 * Middleware that enforces parentId ownership for parent-role requests.
 * Admin/coordinator/teacher pass through.
 * Reads studentId from req.params.studentId or req.body.studentId.
 */
export const requireParentOwnsStudent = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user!
    if (['admin', 'coordinator', 'teacher'].includes(user.role)) {
      return next()
    }

    if (user.role === 'parent') {
      const studentId = req.params.studentId || req.body?.studentId
      if (!studentId || !mongoose.isValidObjectId(studentId)) {
        return next()
      }
      await assertParentOwnsStudent(user.id, studentId)
      return next()
    }

    sendResponse(res, 403, false, 'Access denied')
  } catch (err: any) {
    sendResponse(res, err.statusCode || 500, false, err.message || 'Server error')
  }
}

/**
 * filterStudentListForParent
 *
 * For list endpoints: if the caller is a parent, restrict the studentId
 * filter in the query/body to their own child only.
 * Attaches req._parentStudentFilter = { studentId } for controllers to use.
 *
 * If the parent queries for a student that is not theirs, returns 403.
 */
export const filterStudentListForParent = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = req.user!
    if (user.role !== 'parent') return next()

    // Find the student whose parentId === user.id
    const myStudent = await Student.findOne({ parentId: user.id }).select('_id').lean()
    if (!myStudent) {
      sendResponse(res, 403, false, 'No student is linked to your account')
      return
    }

    const requestedStudentId = req.query.studentId as string | undefined
    if (requestedStudentId && requestedStudentId !== myStudent._id.toString()) {
      sendResponse(res, 403, false, 'Forbidden: You can only access your own child\'s data')
      return
    }

    // Attach to request so controllers can read it
    ;(req as any)._parentStudentFilter = { studentId: myStudent._id.toString() }
    next()
  } catch (err: any) {
    sendResponse(res, err.statusCode || 500, false, err.message || 'Server error')
  }
}
