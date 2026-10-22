import { Response } from 'express'
import mongoose from 'mongoose'
import { Observation } from '../models/observation.model.js'
import { Student } from '../models/student.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import { AcademicTerm } from '../models/academicTerm.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { AuthRequest } from '../middlewares/auth.middleware.js'
import { getTeacherSectionIds } from '../middlewares/access.middleware.js'
import { getCurrentAcademicSnapshot } from '../service/currentAcademic.service.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'
import { getSchoolTimezone, normalizeSchoolDateInput, todaySchoolDate, toSchoolDateString } from '../utils/schoolDate.util.js'

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100
const MAX_DESCRIPTION_LENGTH = 1000

class ObservationError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

function handleError(res: Response, error: unknown): void {
  if (error instanceof ObservationError) {
    sendResponse(res, error.statusCode, false, error.message)
    return
  }
  sendResponse(
    res,
    500,
    false,
    'Internal server error',
    null,
    error instanceof Error ? error.message : error
  )
}

const refId = (value: any): any => (value && value._id ? value._id : value)

function withPopulations(query: any): any {
  return query
    .populate('teacherId', 'firstName lastName')
    .populate('studentId', 'firstName lastName')
    .populate('subjectId', 'name')
}

function parsePositiveInteger(value: unknown, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ObservationError(400, `${name} must be a positive integer`)
  }
  return parsed
}

function parseObjectId(value: unknown, name: string, required = false): string | undefined {
  if (value === undefined || value === '') {
    if (required) throw new ObservationError(400, `${name} is required`)
    return undefined
  }
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) {
    throw new ObservationError(400, `Invalid ${name}`)
  }
  return value
}

function parseDate(value: unknown, timeZone: string, name = 'date'): Date {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ObservationError(400, `${name} is required`)
  }
  const parsed = normalizeSchoolDateInput(value, timeZone)
  if (!parsed) {
    throw new ObservationError(400, `${name} must be a valid date`)
  }
  return parsed
}

function parseDescription(value: unknown, required = false): string | undefined {
  if (value === undefined) {
    if (required) throw new ObservationError(400, 'description is required')
    return undefined
  }
  if (typeof value !== 'string') {
    throw new ObservationError(400, 'description must be a string')
  }
  const description = value.trim()
  if (!description) {
    throw new ObservationError(400, 'description cannot be empty')
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new ObservationError(
      400,
      `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`
    )
  }
  return description
}

function parseOptionalSubjectId(value: unknown): string | undefined {
  if (value === null) return undefined
  return parseObjectId(value, 'subjectId')
}

async function loadCurrentObservationContext() {
  const snapshot = await getCurrentAcademicSnapshot()
  const termStart = toSchoolDateString(snapshot.currentTerm?.startDate, snapshot.timeZone)
  const termEnd = toSchoolDateString(snapshot.currentTerm?.endDate, snapshot.timeZone)
  const isCurrentTerm =
    !!snapshot.currentTerm &&
    !!snapshot.currentCalendar &&
    !!termStart &&
    !!termEnd &&
    termStart <= snapshot.today &&
    snapshot.today <= termEnd

  if (!isCurrentTerm) {
    throw new ObservationError(
      404,
      'No current academic term is available based on calendar dates'
    )
  }

  const schoolYear = normalizeYear(String(snapshot.currentCalendar.academicYear ?? ''))
  if (!/^\d{4}-\d{4}$/.test(schoolYear)) {
    throw new ObservationError(
      404,
      'No current academic term is available based on calendar dates'
    )
  }

  return {
    today: snapshot.today,
    timeZone: snapshot.timeZone,
    termId: String(snapshot.currentTerm._id),
    termStart: termStart!,
    termEnd: termEnd!,
    schoolYear,
  }
}

async function getCurrentSchoolYear(): Promise<string | null> {
  const snapshot = await getCurrentAcademicSnapshot()
  const year = String(snapshot.currentCalendar?.academicYear ?? '')
  const normalized = normalizeYear(year)
  return /^\d{4}-\d{4}$/.test(normalized) ? normalized : null
}

async function getTeacherStudentIds(teacherId: string, schoolYear: string): Promise<string[]> {
  const sectionIds = await getTeacherSectionIds(teacherId, schoolYear)
  if (sectionIds.length === 0) return []

  const enrollments = await StudentEnrollment.find({
    sectionId: { $in: sectionIds },
    isActive: true,
    schoolYear: { $in: getYearVariants(schoolYear) },
  })
    .select('studentId')
    .lean()

  return Array.from(new Set(enrollments.map((enrollment) => String(enrollment.studentId))))
}

async function teacherHasCurrentStudent(
  teacherId: string,
  studentId: string,
  schoolYear: string
): Promise<boolean> {
  const sectionIds = await getTeacherSectionIds(teacherId, schoolYear)
  if (sectionIds.length === 0) return false

  const enrollment = await StudentEnrollment.findOne({
    studentId,
    sectionId: { $in: sectionIds },
    isActive: true,
    schoolYear: { $in: getYearVariants(schoolYear) },
  })
    .select('_id')
    .lean()

  return !!enrollment
}

const SUBJECT_REQUIRED_MESSAGE =
  "subjectId is required because you teach multiple subjects in this student's section"
const SUBJECT_NOT_TAUGHT_MESSAGE =
  'Forbidden: You do not teach this subject in the student\'s section'

async function resolveObservationSubject(
  teacherId: string,
  studentId: string,
  schoolYear: string,
  requestedSubjectId?: string
): Promise<mongoose.Types.ObjectId | null> {
  const sectionIds = await getTeacherSectionIds(teacherId, schoolYear)
  if (sectionIds.length === 0) {
    throw new ObservationError(403, 'Forbidden: Student is not in one of your current sections')
  }

  const enrollment = await StudentEnrollment.findOne({
    studentId,
    sectionId: { $in: sectionIds },
    isActive: true,
    schoolYear: { $in: getYearVariants(schoolYear) },
  })
    .select('sectionId')
    .lean()

  if (!enrollment?.sectionId) {
    throw new ObservationError(403, 'Forbidden: Student is not in one of your current sections')
  }

  const assignments = await TeachingAssignment.find({
    teacherId,
    sectionId: enrollment.sectionId,
    role: 'subject',
    subjectId: { $ne: null },
    schoolYear: { $in: getYearVariants(schoolYear) },
  })
    .select('subjectId')
    .lean()

  const subjectIds = Array.from(
    new Set(
      assignments
        .map((assignment) =>
          assignment.subjectId ? String(assignment.subjectId) : null
        )
        .filter((subjectId): subjectId is string => !!subjectId)
    )
  )

  if (subjectIds.length === 0) {
    if (requestedSubjectId) {
      throw new ObservationError(403, SUBJECT_NOT_TAUGHT_MESSAGE)
    }
    return null
  }

  if (requestedSubjectId) {
    if (!subjectIds.includes(requestedSubjectId)) {
      throw new ObservationError(403, SUBJECT_NOT_TAUGHT_MESSAGE)
    }
    return new mongoose.Types.ObjectId(requestedSubjectId)
  }

  if (subjectIds.length > 1) {
    throw new ObservationError(400, SUBJECT_REQUIRED_MESSAGE)
  }

  return new mongoose.Types.ObjectId(subjectIds[0])
}

async function getParentStudentIds(parentId: string): Promise<string[]> {
  const students = await Student.find({ parentId }).select('_id').lean()
  return students.map((student) => String(student._id))
}

async function assertTeacherObservationAccess(
  observation: any,
  teacherId: string
): Promise<void> {
  if (String(refId(observation.teacherId)) !== teacherId) {
    throw new ObservationError(403, 'Forbidden: You can only access your own observations')
  }

  const schoolYear = await getCurrentSchoolYear()
  if (!schoolYear) {
    throw new ObservationError(403, 'No current academic year is available')
  }

  const hasAccess = await teacherHasCurrentStudent(
    teacherId,
    String(refId(observation.studentId)),
    schoolYear
  )
  if (!hasAccess) {
    throw new ObservationError(
      403,
      'Forbidden: Student is not in one of your current sections'
    )
  }
}

type ListQuery = {
  page: number
  limit: number
  studentId?: string
  teacherId?: string
  subjectId?: string
  schoolYear?: string
  term?: string
  from?: Date
  to?: Date
}

async function parseListQuery(req: AuthRequest): Promise<ListQuery> {
  const timeZone = await getSchoolTimezone()
  const page = parsePositiveInteger(req.query.page, 1, 'page')
  const limit = Math.min(
    parsePositiveInteger(req.query.limit, DEFAULT_PAGE_SIZE, 'limit'),
    MAX_PAGE_SIZE
  )

  const studentId = parseObjectId(req.query.studentId, 'studentId')
  const teacherId = parseObjectId(req.query.teacherId, 'teacherId')
  const subjectId = parseObjectId(req.query.subjectId, 'subjectId')
  const term = parseObjectId(
    req.query.term ?? req.query.termId ?? req.query.academicTermId,
    'term'
  )

  let schoolYear: string | undefined
  const rawSchoolYear = req.query.schoolYear
  if (rawSchoolYear !== undefined && rawSchoolYear !== '') {
    if (
      typeof rawSchoolYear !== 'string' ||
      !/^\d{4}-(\d{4}|\d{2})$/.test(rawSchoolYear.trim())
    ) {
      throw new ObservationError(
        400,
        'schoolYear must be in YYYY-YYYY or YYYY-YY format'
      )
    }
    schoolYear = normalizeYear(rawSchoolYear.trim())
  }

  const fromInput = req.query.from ?? req.query.startDate
  const toInput = req.query.to ?? req.query.endDate
  const from = fromInput === undefined || fromInput === ''
    ? undefined
    : parseDate(fromInput, timeZone, 'from')
  const to = toInput === undefined || toInput === ''
    ? undefined
    : parseDate(toInput, timeZone, 'to')

  if (from && to && from.getTime() > to.getTime()) {
    throw new ObservationError(400, 'from must be before or equal to to')
  }

  return { page, limit, studentId, teacherId, subjectId, schoolYear, term, from, to }
}

function applyCommonFilters(filter: Record<string, any>, query: ListQuery): void {
  if (query.subjectId) filter.subjectId = query.subjectId
  if (query.schoolYear) filter.schoolYear = { $in: getYearVariants(query.schoolYear) }
  if (query.term) filter.term = query.term

  if (query.from || query.to) {
    filter.date = {}
    if (query.from) filter.date.$gte = query.from
    if (query.to) filter.date.$lte = query.to
  }
}

export const getAllObservations = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!
    const role = user.role
    const query = await parseListQuery(req)
    const filter: Record<string, any> = {}

    applyCommonFilters(filter, query)

    if (role === 'admin' || role === 'coordinator') {
      if (query.studentId) filter.studentId = query.studentId
      if (query.teacherId) filter.teacherId = query.teacherId
    } else if (role === 'teacher') {
      if (query.teacherId && query.teacherId !== String(user.id)) {
        throw new ObservationError(
          403,
          'Forbidden: You can only view your own observations'
        )
      }

      filter.teacherId = user.id

      const schoolYear = await getCurrentSchoolYear()
      const allowedStudentIds = schoolYear
        ? await getTeacherStudentIds(String(user.id), schoolYear)
        : []

      if (query.studentId) {
        if (!allowedStudentIds.includes(query.studentId)) {
          throw new ObservationError(
            403,
            'Forbidden: Student is not in one of your current sections'
          )
        }
        filter.studentId = query.studentId
      } else {
        filter.studentId = { $in: allowedStudentIds }
      }
    } else if (role === 'parent') {
      const childIds = await getParentStudentIds(String(user.id))
      if (query.studentId) {
        if (!childIds.includes(query.studentId)) {
          throw new ObservationError(
            403,
            'Forbidden: You can only view your own children\'s observations'
          )
        }
        filter.studentId = query.studentId
      } else {
        filter.studentId = { $in: childIds }
      }
      if (query.teacherId) filter.teacherId = query.teacherId
    } else {
      throw new ObservationError(403, 'Access denied')
    }

    const skip = (query.page - 1) * query.limit
    const [observations, total] = await Promise.all([
      withPopulations(Observation.find(filter))
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(query.limit),
      Observation.countDocuments(filter),
    ])

    sendResponse(res, 200, true, 'Observations fetched successfully', observations, null, {
      total,
      page: query.page,
      limit: query.limit,
    })
  } catch (error) {
    handleError(res, error)
  }
}

export const getObservationById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      throw new ObservationError(400, 'Invalid observation ID')
    }

    const observation = await withPopulations(Observation.findById(id))
    if (!observation) {
      throw new ObservationError(404, 'Observation not found.')
    }

    const user = req.user!
    const studentId = String(refId(observation.studentId))

    if (user.role === 'admin' || user.role === 'coordinator') {
      // Full access.
    } else if (user.role === 'teacher') {
      await assertTeacherObservationAccess(observation, String(user.id))
    } else if (user.role === 'parent') {
      const childIds = await getParentStudentIds(String(user.id))
      if (!childIds.includes(studentId)) {
        throw new ObservationError(
          403,
          'Forbidden: You can only view your own children\'s observations'
        )
      }
    } else {
      throw new ObservationError(403, 'Access denied')
    }

    sendResponse(res, 200, true, 'Observation fetched successfully', observation)
  } catch (error) {
    handleError(res, error)
  }
}

export const createObservation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!
    if (user.role !== 'teacher') {
      throw new ObservationError(403, 'Access denied')
    }

    const body = req.body ?? {}
    if (body.studentId === undefined || body.studentId === '') {
      throw new ObservationError(400, 'Missing required field: studentId')
    }
    const studentId = parseObjectId(body.studentId, 'studentId', true)!
    if (body.teacherId !== undefined && String(body.teacherId) !== String(user.id)) {
      throw new ObservationError(400, 'teacherId must match the authenticated teacher')
    }

    if (body.date === undefined) {
      throw new ObservationError(400, 'Missing required field: date')
    }
    if (body.description === undefined) {
      throw new ObservationError(400, 'Missing required field: description')
    }

    const current = await loadCurrentObservationContext()
    const date = parseDate(body.date, current.timeZone)
    const dateString = toSchoolDateString(date, current.timeZone)!

    if (dateString > current.today) {
      throw new ObservationError(400, 'Cannot record observation for a future date')
    }
    if (dateString < current.termStart || dateString > current.termEnd) {
      throw new ObservationError(
        400,
        `date must fall within the current academic term (${current.termStart} – ${current.termEnd})`
      )
    }

    const student = await Student.findById(studentId).select('_id').lean()
    if (!student) {
      throw new ObservationError(404, 'Student not found.')
    }

    const requestedSubjectId = parseOptionalSubjectId(body.subjectId)
    const subjectId = await resolveObservationSubject(
      String(user.id),
      studentId,
      current.schoolYear,
      requestedSubjectId
    )

    const description = parseDescription(body.description, true)!

    const observation = await Observation.create({
      studentId,
      teacherId: user.id,
      date,
      subjectId,
      description,
      schoolYear: current.schoolYear,
      term: current.termId,
    })

    const populatedObservation = await withPopulations(Observation.findById(observation._id))
    sendResponse(
      res,
      201,
      true,
      'Observation created successfully.',
      populatedObservation
    )
  } catch (error) {
    handleError(res, error)
  }
}

export const updateObservation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!
    if (user.role !== 'teacher') {
      throw new ObservationError(403, 'Access denied')
    }

    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      throw new ObservationError(400, 'Invalid observation ID')
    }

    const observation = await Observation.findById(id)
    if (!observation) {
      throw new ObservationError(404, 'Observation not found.')
    }

    await assertTeacherObservationAccess(observation, String(user.id))

    const body = req.body ?? {}
    if (
      body.studentId !== undefined &&
      String(body.studentId) !== String(observation.studentId)
    ) {
      throw new ObservationError(400, 'studentId cannot be changed')
    }
    if (
      body.teacherId !== undefined &&
      String(body.teacherId) !== String(observation.teacherId)
    ) {
      throw new ObservationError(400, 'teacherId cannot be changed')
    }

    const updates: Record<string, any> = {}

    if (body.date !== undefined) {
      const timeZone = await getSchoolTimezone()
      const date = parseDate(body.date, timeZone)
      const dateString = toSchoolDateString(date, timeZone)!
      const today = todaySchoolDate(timeZone)

      if (dateString > today) {
        throw new ObservationError(400, 'Cannot record observation for a future date')
      }

      if (!mongoose.isValidObjectId(observation.term)) {
        throw new ObservationError(400, 'Observation has no valid academic term')
      }
      const term = await AcademicTerm.findById(observation.term)
        .select('startDate endDate')
        .lean()
      const termStart = toSchoolDateString(term?.startDate, timeZone)
      const termEnd = toSchoolDateString(term?.endDate, timeZone)
      if (!term || !termStart || !termEnd) {
        throw new ObservationError(400, 'Observation has no valid academic term')
      }
      if (dateString < termStart || dateString > termEnd) {
        throw new ObservationError(
          400,
          `date must fall within the observation's academic term (${termStart} – ${termEnd})`
        )
      }

      updates.date = date
    }

    if (body.subjectId !== undefined) {
      const requestedSubjectId = parseOptionalSubjectId(body.subjectId)
      const schoolYear = await getCurrentSchoolYear()
      if (!schoolYear) {
        throw new ObservationError(403, 'No current academic year is available')
      }
      updates.subjectId = await resolveObservationSubject(
        String(user.id),
        String(observation.studentId),
        schoolYear,
        requestedSubjectId
      )
    }

    if (body.description !== undefined) {
      updates.description = parseDescription(body.description)
    }

    if (Object.keys(updates).length === 0) {
      throw new ObservationError(
        400,
        'At least one field (date, subjectId, description) required.'
      )
    }

    const updated = await withPopulations(
      Observation.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true })
    )

    sendResponse(res, 200, true, 'Observation updated successfully.', updated)
  } catch (error) {
    handleError(res, error)
  }
}

export const deleteObservation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!
    const { id } = req.params
    if (!mongoose.isValidObjectId(id)) {
      throw new ObservationError(400, 'Invalid observation ID')
    }

    const observation = await Observation.findById(id)
    if (!observation) {
      throw new ObservationError(404, 'Observation not found.')
    }

    if (user.role === 'teacher') {
      await assertTeacherObservationAccess(observation, String(user.id))
    } else if (user.role !== 'admin' && user.role !== 'coordinator') {
      throw new ObservationError(403, 'Access denied')
    }

    await Observation.findByIdAndDelete(id)
    sendResponse(res, 200, true, 'Observation deleted successfully.')
  } catch (error) {
    handleError(res, error)
  }
}

export const bulkDeleteObservationsByStudent = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  try {
    const { studentId } = req.params
    if (!mongoose.isValidObjectId(studentId)) {
      throw new ObservationError(400, 'Invalid studentId')
    }

    const student = await Student.findById(studentId).select('_id').lean()
    if (!student) {
      throw new ObservationError(404, 'Student not found.')
    }

    const result = await Observation.deleteMany({ studentId })
    sendResponse(
      res,
      200,
      true,
      `Deleted ${result.deletedCount} observations successfully.`
    )
  } catch (error) {
    handleError(res, error)
  }
}
