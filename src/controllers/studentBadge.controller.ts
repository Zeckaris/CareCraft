import { Response } from 'express'
import mongoose from 'mongoose'
import { StudentBadge } from '../models/studentBadge.model.js'
import { BadgeDefinition } from '../models/badgeDefinition.model.js'
import { Student } from '../models/student.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { AuthRequest } from '../middlewares/auth.middleware.js'
import {
  assertTeacherCanWriteStudent,
  assertTeacherCanReadStudent,
  assertParentOwnsStudent,
  getTeacherSectionIds,
} from '../middlewares/access.middleware.js'
import { getCurrentAcademicSnapshot } from '../service/currentAcademic.service.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'

const BADGE_POPULATE_FIELDS = 'name description icon level eligibleGrades autoAward'

// ─── helpers ─────────────────────────────────────────────────────────────────

async function buildStudentConstraint(req: AuthRequest): Promise<any> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return {}

  if (user.role === 'parent') {
    const myStudents = await Student.find({ parentId: user.id })
      .select('_id')
      .lean()
    return { studentId: { $in: myStudents.map((student) => student._id) } }
  }

  if (user.role === 'teacher') {
    const sectionIds = await getTeacherSectionIds(user.id)
    const enrollments = await StudentEnrollment.find({
      sectionId: { $in: sectionIds },
      isActive: true,
    })
      .select('studentId')
      .lean()
    const studentIds = enrollments.map((e) => e.studentId)
    return { studentId: { $in: studentIds } }
  }

  return { studentId: new mongoose.Types.ObjectId() }
}

async function loadCurrentTermContext(): Promise<{
  schoolYear: string
  academicTermId: mongoose.Types.ObjectId
}> {
  const snapshot = await getCurrentAcademicSnapshot()
  const schoolYear = normalizeYear(
    String(snapshot.currentCalendar?.academicYear ?? '')
  )

  if (
    !snapshot.currentCalendar ||
    !snapshot.currentTerm ||
    !/^\d{4}-\d{4}$/.test(schoolYear)
  ) {
    const error: any = new Error(
      'No current academic term is available based on calendar dates'
    )
    error.statusCode = 404
    throw error
  }

  return {
    schoolYear,
    academicTermId: new mongoose.Types.ObjectId(String(snapshot.currentTerm._id)),
  }
}

async function assertCanManageAward(
  req: AuthRequest,
  award: {
    studentId: mongoose.Types.ObjectId
    awardedBy?: mongoose.Types.ObjectId | null
    source: string
  }
): Promise<void> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return

  if (user.role !== 'teacher') {
    const error: any = new Error('Access denied')
    error.statusCode = 403
    throw error
  }

  if (!award.awardedBy || String(award.awardedBy) !== user.id) {
    const error: any = new Error(
      'Forbidden: You can only modify badges that you awarded'
    )
    error.statusCode = 403
    throw error
  }

  await assertTeacherCanWriteStudent(user.id, award.studentId)
}

async function assertCanDeleteAward(
  req: AuthRequest,
  award: {
    studentId: mongoose.Types.ObjectId
    source: string
  }
): Promise<void> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return

  if (user.role !== 'teacher') {
    const error: any = new Error('Access denied')
    error.statusCode = 403
    throw error
  }

  if (award.source === 'system') {
    const error: any = new Error(
      'Forbidden: System awards can only be deleted by an admin or coordinator'
    )
    error.statusCode = 403
    throw error
  }

  await assertTeacherCanWriteStudent(user.id, award.studentId)
}

function populateAwardQuery(query: any): any {
  return query
    .populate('badgeId', BADGE_POPULATE_FIELDS)
    .populate('studentId', 'firstName lastName')
    .populate('awardedBy', 'firstName lastName email role')
    .populate('academicTermId', 'name startDate endDate')
}

// ─── GET ALL ─────────────────────────────────────────────────────────────────

export const getAllStudentBadges = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const {
    page = 1,
    limit = 10,
    studentId,
    badgeId,
    schoolYear,
    academicTermId,
    source,
    awardedBy,
  } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const constraint = await buildStudentConstraint(req)
  const filter: any = { ...constraint }

  if (studentId) {
    if (!mongoose.isValidObjectId(studentId)) {
      sendResponse(res, 400, false, 'Invalid studentId')
      return
    }
    filter.studentId = studentId
  }
  if (badgeId) {
    if (!mongoose.isValidObjectId(badgeId)) {
      sendResponse(res, 400, false, 'Invalid badgeId')
      return
    }
    const badgeDefinition = await BadgeDefinition.findById(badgeId)
    if (!badgeDefinition) {
      sendResponse(res, 404, false, 'BadgeDefinition not found')
      return
    }
    filter.badgeId = badgeId
  }
  if (schoolYear) {
    filter.schoolYear = { $in: getYearVariants(String(schoolYear)) }
  }
  if (academicTermId) {
    if (!mongoose.isValidObjectId(academicTermId)) {
      sendResponse(res, 400, false, 'Invalid academicTermId')
      return
    }
    filter.academicTermId = academicTermId
  }
  if (source) {
    if (!['teacher', 'admin', 'system'].includes(String(source))) {
      sendResponse(res, 400, false, 'Invalid source: must be teacher, admin, or system')
      return
    }
    filter.source = source
  }
  if (awardedBy) {
    const user = req.user!
    if (!['admin', 'coordinator'].includes(user.role)) {
      sendResponse(res, 403, false, 'Access denied')
      return
    }
    if (!mongoose.isValidObjectId(awardedBy)) {
      sendResponse(res, 400, false, 'Invalid awardedBy')
      return
    }
    filter.awardedBy = awardedBy
  }

  // Never let a query filter override the caller's role scope.
  if (Object.keys(constraint).length > 0) {
    filter.$and = [...(filter.$and ?? []), constraint]
  }

  try {
    const badges = await populateAwardQuery(StudentBadge.find(filter))
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean()
    const total = await StudentBadge.countDocuments(filter)

    sendResponse(res, 200, true, 'Student badges fetched successfully', badges, null, {
      total,
      page: Number(page),
      limit: Number(limit),
    })
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error fetching student badges: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── GET BY ID ───────────────────────────────────────────────────────────────

export const getStudentBadgeById = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid student badge ID')
    return
  }

  try {
    const badge = await populateAwardQuery(StudentBadge.findById(id)).lean()
    if (!badge) {
      sendResponse(res, 404, false, 'StudentBadge not found')
      return
    }

    const user = req.user!
    const studentId = (badge.studentId as any)?._id || badge.studentId
    if (user.role === 'parent') {
      await assertParentOwnsStudent(user.id, studentId)
    } else if (user.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, studentId)
    }

    sendResponse(res, 200, true, 'Student badge fetched successfully', badge)
  } catch (error: any) {
    sendResponse(
      res,
      error.statusCode || 500,
      false,
      error.message || 'Server error fetching student badge',
      null,
      error
    )
  }
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

export const createStudentBadge = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { badgeId, studentId, note } = req.body

  if (!badgeId || !studentId) {
    sendResponse(res, 400, false, 'Missing required fields: badgeId, studentId')
    return
  }
  if (!mongoose.isValidObjectId(badgeId)) {
    sendResponse(res, 400, false, 'Invalid badgeId')
    return
  }
  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId')
    return
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    sendResponse(res, 400, false, 'note must be a string')
    return
  }

  try {
    const user = req.user!

    if (user.role === 'teacher') {
      await assertTeacherCanWriteStudent(user.id, studentId)
    }

    const badgeDefinition = await BadgeDefinition.findById(badgeId)
    if (!badgeDefinition) {
      sendResponse(res, 404, false, 'BadgeDefinition not found')
      return
    }

    const student = await Student.findById(studentId)
    if (!student) {
      sendResponse(res, 404, false, 'Student not found')
      return
    }

    const { schoolYear, academicTermId } = await loadCurrentTermContext()

    const enrollment = await StudentEnrollment.findOne({
      studentId,
      schoolYear: { $in: getYearVariants(schoolYear) },
    })
      .sort({ isActive: -1, createdAt: -1 })
      .select('gradeId isActive')
      .lean()

    if (!enrollment) {
      sendResponse(
        res,
        400,
        false,
        `Student is not enrolled in the current school year (${schoolYear})`
      )
      return
    }

    const eligibleGrades = (badgeDefinition.eligibleGrades ?? []).map(String)
    if (eligibleGrades.length === 0) {
      sendResponse(
        res,
        400,
        false,
        'Badge is not enabled for any grade yet; an admin must assign eligible grades first'
      )
      return
    }
    if (!eligibleGrades.includes(String(enrollment.gradeId))) {
      sendResponse(
        res,
        400,
        false,
        "Student's grade is not eligible for this badge"
      )
      return
    }

    const existingBadge = await StudentBadge.findOne({
      badgeId,
      studentId,
      academicTermId,
    })
    if (existingBadge) {
      sendResponse(
        res,
        400,
        false,
        'Student has already been awarded this badge in the current term'
      )
      return
    }

    const studentBadge = await StudentBadge.create({
      badgeId,
      studentId,
      schoolYear,
      academicTermId,
      source: user.role === 'teacher' ? 'teacher' : 'admin',
      awardedBy: user.id,
      note: typeof note === 'string' ? note.trim() : '',
    })

    const populated = await populateAwardQuery(
      StudentBadge.findById(studentBadge._id)
    ).lean()

    sendResponse(res, 201, true, 'Student badge created successfully', populated)
  } catch (error: any) {
    if (error?.code === 11000) {
      sendResponse(
        res,
        400,
        false,
        'Student has already been awarded this badge in the current term'
      )
      return
    }
    sendResponse(
      res,
      error.statusCode || 500,
      false,
      error.message || 'Server error creating student badge',
      null,
      error
    )
  }
}

// ─── UPDATE (note only) ──────────────────────────────────────────────────────

export const updateStudentBadge = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid student badge ID')
    return
  }

  const fields = Object.keys(req.body ?? {})
  if (fields.length === 0 || fields.some((field) => field !== 'note')) {
    sendResponse(res, 400, false, 'Only note can be updated on an award')
    return
  }
  const { note } = req.body
  if (note !== null && typeof note !== 'string') {
    sendResponse(res, 400, false, 'note must be a string or null')
    return
  }

  try {
    const studentBadge = await StudentBadge.findById(id)
    if (!studentBadge) {
      sendResponse(res, 404, false, 'StudentBadge not found')
      return
    }

    await assertCanManageAward(req, studentBadge)

    const updated = await populateAwardQuery(
      StudentBadge.findByIdAndUpdate(
        id,
        { note: typeof note === 'string' ? note.trim() : '' },
        { new: true }
      )
    ).lean()

    sendResponse(res, 200, true, 'Student badge updated successfully', updated)
  } catch (error: any) {
    sendResponse(
      res,
      error.statusCode || 500,
      false,
      error.message || 'Server error updating student badge',
      null,
      error
    )
  }
}

// ─── DELETE ──────────────────────────────────────────────────────────────────

export const deleteStudentBadge = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid student badge ID')
    return
  }

  try {
    const studentBadge = await StudentBadge.findById(id)
    if (!studentBadge) {
      sendResponse(res, 404, false, 'StudentBadge not found')
      return
    }

    await assertCanDeleteAward(req, studentBadge)

    await StudentBadge.findByIdAndDelete(id)
    sendResponse(res, 200, true, 'Student badge deleted successfully')
  } catch (error: any) {
    sendResponse(
      res,
      error.statusCode || 500,
      false,
      error.message || 'Server error deleting student badge',
      null,
      error
    )
  }
}
