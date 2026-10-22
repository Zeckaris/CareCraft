import { Response } from 'express'
import mongoose from 'mongoose'
import { StudentBadge } from '../models/studentBadge.model.js'
import { BadgeDefinition } from '../models/badgeDefinition.model.js'
import { Student } from '../models/student.model.js'
import { BadgeAwardSuppression } from '../models/badgeAwardSuppression.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { AuthRequest } from '../middlewares/auth.middleware.js'
import {
  assertTeacherCanWriteStudent,
  assertTeacherCanReadStudent,
  assertParentOwnsStudent,
  getTeacherSectionIds,
  isHomeroomForStudent,
} from '../middlewares/access.middleware.js'
import {
  NO_CURRENT_TERM_MESSAGE,
  resolveCurrentBadgeWindow,
} from '../service/badgeWindow.service.js'
import { awardStudentBadge, GIFT_CLAIM_WINDOW_DAYS } from '../service/studentBadgeAward.service.js'
import { getYearVariants } from '../utils/yearNormalizer.js'
import {
  buildBadgeEvaluationContext,
  evaluateBadgeCriteria,
} from '../badges/criteriaEvaluator.js'
import { resolveCurrentBadgeEnrollment } from '../service/badgeWindow.service.js'

const BADGE_POPULATE_FIELDS =
  'name description howToEarn icon level eligibleGrades autoAward giftId giftQuantity'
const GIFT_POPULATE_FIELDS = 'name description image isActive'

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
    .populate({
      path: 'badgeId',
      select: BADGE_POPULATE_FIELDS,
      populate: { path: 'giftId', select: GIFT_POPULATE_FIELDS },
    })
    .populate('studentId', 'firstName lastName')
    .populate('awardedBy', 'firstName lastName email role')
    .populate('giftId', GIFT_POPULATE_FIELDS)
    .populate('giftGivenBy', 'firstName lastName email role')
    .populate('academicTermId', 'name startDate endDate')
}

function shapeAward(award: any): any {
  if (!award) return award
  const giftStatus =
    award.giftStatus === 'pending' || award.giftStatus === 'given'
      ? award.giftStatus
      : 'none'
  const createdAt = award.createdAt ? new Date(award.createdAt) : null
  const giftClaimBy =
    giftStatus !== 'none' && createdAt
      ? new Date(
          createdAt.getTime() +
            GIFT_CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000
        )
      : null

  return { ...award, giftStatus, giftClaimBy }
}

function shapeAwards(awards: any[]): any[] {
  return awards.map(shapeAward)
}

async function assertCanUpdateGift(
  req: AuthRequest,
  studentId: mongoose.Types.ObjectId
): Promise<void> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return

  if (user.role !== 'teacher') {
    const error: any = new Error('Access denied')
    error.statusCode = 403
    throw error
  }

  const homeroom = await isHomeroomForStudent(user.id, studentId)
  if (!homeroom) {
    const error: any = new Error(
      'Forbidden: Only the homeroom teacher can update gift status for this student'
    )
    error.statusCode = 403
    throw error
  }
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
    giftStatus,
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
  if (giftStatus) {
    if (!['pending', 'given'].includes(String(giftStatus))) {
      sendResponse(
        res,
        400,
        false,
        'Invalid giftStatus: must be pending or given'
      )
      return
    }
    filter.giftStatus = String(giftStatus)
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

    sendResponse(res, 200, true, 'Student badges fetched successfully', shapeAwards(badges), null, {
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

    sendResponse(res, 200, true, 'Student badge fetched successfully', shapeAward(badge))
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

    const { term } = await resolveCurrentBadgeWindow()
    if (!term) {
      sendResponse(res, 404, false, NO_CURRENT_TERM_MESSAGE)
      return
    }

    const result = await awardStudentBadge({
      badge: badgeDefinition,
      student,
      term,
      actor: {
        type: 'user',
        user: { id: user.id, role: user.role },
      },
      note: typeof note === 'string' ? note : undefined,
    })

    if (result.status === 'failed') {
      sendResponse(res, result.statusCode, false, result.message)
      return
    }
    if (result.status === 'alreadyAwarded') {
      sendResponse(
        res,
        400,
        false,
        'Student has already been awarded this badge in the current term'
      )
      return
    }
    if (result.status === 'suppressed') {
      sendResponse(res, 403, false, 'Access denied')
      return
    }

    const populated = await populateAwardQuery(
      StudentBadge.findById(result.award._id)
    ).lean()

    sendResponse(res, 201, true, 'Student badge created successfully', shapeAward(populated))
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

    sendResponse(res, 200, true, 'Student badge updated successfully', shapeAward(updated))
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

// ─── UPDATE GIFT STATUS ──────────────────────────────────────────────────────

export const updateStudentBadgeGift = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid student badge ID')
    return
  }

  const body = req.body ?? {}
  const fields = Object.keys(body)
  if (fields.some((field) => !['given', 'note'].includes(field))) {
    sendResponse(res, 400, false, 'Only given and note can be updated')
    return
  }

  const { given, note } = body
  if (typeof given !== 'boolean') {
    sendResponse(res, 400, false, 'given must be true or false')
    return
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    sendResponse(res, 400, false, 'note must be a string')
    return
  }
  if (typeof note === 'string' && note.trim().length > 300) {
    sendResponse(res, 400, false, 'note must be at most 300 characters')
    return
  }
  if (given === false && note !== undefined) {
    sendResponse(
      res,
      400,
      false,
      'note can only be set when marking a gift as given'
    )
    return
  }

  try {
    const studentBadge = await StudentBadge.findById(id)
    if (!studentBadge) {
      sendResponse(res, 404, false, 'StudentBadge not found')
      return
    }

    const currentStatus = studentBadge.giftStatus ?? 'none'
    if (currentStatus === 'none') {
      sendResponse(res, 400, false, 'This badge award does not include a gift')
      return
    }
    if (given === true && currentStatus === 'given') {
      sendResponse(res, 400, false, 'Gift has already been marked as given')
      return
    }
    if (given === false && currentStatus === 'pending') {
      sendResponse(res, 400, false, 'Gift is already pending')
      return
    }

    await assertCanUpdateGift(req, studentBadge.studentId)

    const updateData = given
      ? {
          giftStatus: 'given' as const,
          giftGivenAt: new Date(),
          giftGivenBy: req.user!.id,
          giftNote: typeof note === 'string' ? note.trim() : '',
        }
      : {
          giftStatus: 'pending' as const,
          giftGivenAt: null,
          giftGivenBy: null,
          giftNote: '',
        }

    const updated = await populateAwardQuery(
      StudentBadge.findByIdAndUpdate(id, updateData, { new: true })
    ).lean()

    sendResponse(res, 200, true, 'Gift status updated successfully', shapeAward(updated))
  } catch (error: any) {
    sendResponse(
      res,
      error.statusCode || 500,
      false,
      error.message || 'Server error updating gift status',
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

    if (
      studentBadge.source === 'system' &&
      studentBadge.academicTermId &&
      ['admin', 'coordinator'].includes(req.user!.role)
    ) {
      await BadgeAwardSuppression.updateOne(
        {
          studentId: studentBadge.studentId,
          badgeId: studentBadge.badgeId,
          academicTermId: studentBadge.academicTermId,
        },
        { $setOnInsert: { createdBy: req.user!.id } },
        { upsert: true }
      )
    }

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


// ─── PROGRESS ────────────────────────────────────────────────────────────────

/**
 * GET /api/studentBadge/progress?studentId=<id>
 *
 * Computes current-term badge progress on request with the same evaluator used
 * by the background worker.
 */
export const getStudentBadgeProgress = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const studentId = String(req.query.studentId ?? '')

  if (!mongoose.isValidObjectId(studentId)) {
    sendResponse(res, 400, false, 'Invalid studentId')
    return
  }

  try {
    const student = await Student.findById(studentId)
      .select('firstName middleName lastName parentId')
      .lean()
    if (!student) {
      sendResponse(res, 404, false, 'Student not found')
      return
    }

    const user = req.user!
    if (user.role === 'parent') {
      await assertParentOwnsStudent(user.id, student._id)
    } else if (user.role === 'teacher') {
      const homeroom = await isHomeroomForStudent(user.id, student._id)
      if (!homeroom) {
        sendResponse(
          res,
          403,
          false,
          'Forbidden: Only the homeroom teacher can view badge progress for this student'
        )
        return
      }
    } else if (!['admin', 'coordinator'].includes(user.role)) {
      sendResponse(res, 403, false, 'Access denied')
      return
    }

    const { term, schoolYear, snapshot } = await resolveCurrentBadgeWindow()
    if (!term || !schoolYear) {
      sendResponse(res, 400, false, NO_CURRENT_TERM_MESSAGE)
      return
    }

    const enrollment = await resolveCurrentBadgeEnrollment(
      student._id,
      schoolYear
    )
    if (!enrollment) {
      sendResponse(
        res,
        400,
        false,
        `Student is not enrolled in the current school year (${schoolYear})`
      )
      return
    }

    const [eligibleBadges, awards] = await Promise.all([
      BadgeDefinition.find({
        autoAward: true,
        eligibleGrades: enrollment.gradeId,
      })
        .populate('criteria')
        .populate('giftId', GIFT_POPULATE_FIELDS)
        .lean(),
      StudentBadge.find({
        studentId: student._id,
        academicTermId: term._id,
      }).lean(),
    ])

    const awardByBadgeId = new Map(
      awards.map((award: any) => [String(award.badgeId), award])
    )
    const badgeById = new Map(
      (eligibleBadges as any[]).map((badge: any) => [String(badge._id), badge])
    )

    const extraBadgeIds = awards
      .map((award: any) => String(award.badgeId))
      .filter((badgeId: string) => !badgeById.has(badgeId))

    if (extraBadgeIds.length > 0) {
      const extraBadges = await BadgeDefinition.find({
        _id: { $in: extraBadgeIds },
      })
        .populate('criteria')
        .populate('giftId', GIFT_POPULATE_FIELDS)
        .lean()
      for (const badge of extraBadges as any[]) {
        badgeById.set(String(badge._id), badge)
      }
    }

    const badges = Array.from(badgeById.values())
    const context = await buildBadgeEvaluationContext({
      studentId: student._id,
      term,
      schoolYear,
      timeZone: snapshot.timeZone,
      enrollment,
    })

    const results = badges.map((badge: any) => {
      const evaluation = evaluateBadgeCriteria(badge, context)
      const award = awardByBadgeId.get(String(badge._id))
      return {
        badge: {
          _id: badge._id,
          name: badge.name,
          description: badge.description,
          howToEarn: badge.howToEarn ?? '',
          icon: badge.icon ?? '',
          level: badge.level,
          autoAward: badge.autoAward,
          giftId: badge.giftId ?? null,
          giftQuantity: badge.giftQuantity ?? null,
        },
        earned: !!award,
        awardId: award?._id ?? null,
        awardedAt: award?.createdAt ?? null,
        source: award?.source ?? null,
        criteria: evaluation.criteria,
        allMet: evaluation.allMet,
      }
    })

    sendResponse(res, 200, true, 'Badge progress fetched successfully', {
      studentId: student._id,
      schoolYear,
      academicTerm: {
        _id: term._id,
        name: term.name,
        startDate: term.startDate,
        endDate: term.endDate,
      },
      badges: results,
    })
  } catch (error: any) {
    sendResponse(
      res,
      error?.statusCode || 500,
      false,
      error?.message || 'Server error fetching badge progress',
      null,
      error
    )
  }
}
