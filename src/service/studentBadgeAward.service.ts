import { Types } from 'mongoose'
import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { BadgeAwardSuppression } from '../models/badgeAwardSuppression.model.js'
import { Notification } from '../models/notification.model.js'
import { StudentBadge } from '../models/studentBadge.model.js'
import { assertTeacherCanWriteStudent } from '../middlewares/access.middleware.js'
import { resolveCurrentBadgeEnrollment } from './badgeWindow.service.js'
import { normalizeYear } from '../utils/yearNormalizer.js'

export type AwardActor =
  | {
      type: 'user'
      user: { id: string | Types.ObjectId; role: string }
    }
  | { type: 'system' }

export type AwardStudentBadgeResult =
  | { status: 'created'; award: any }
  | { status: 'alreadyAwarded' }
  | { status: 'suppressed' }
  | { status: 'failed'; statusCode: number; message: string }

export interface AwardStudentBadgeInput {
  badge: any
  student: any
  term: any
  actor: AwardActor
  note?: string
}

function studentName(student: any): string {
  return (
    [student?.firstName, student?.middleName, student?.lastName]
      .filter(Boolean)
      .join(' ') || 'Student'
  )
}

function failure(statusCode: number, message: string): AwardStudentBadgeResult {
  return { status: 'failed', statusCode, message }
}

async function notifyParent(input: {
  student: any
  badge: any
}): Promise<void> {
  const parentId = input.student?.parentId
  if (!parentId) return

  try {
    await Notification.create({
      userId: parentId,
      type: 'badge_earned',
      title: 'Badge earned',
      message: `${studentName(input.student)} earned the ${input.badge.name} badge.`,
      isRead: false,
      priority: 'normal',
      studentId: input.student._id,
      badgeId: input.badge._id,
    })
  } catch (error) {
    console.error('Failed to create badge notification:', error)
  }
}

/**
 * Shared award path for manual and system awards. This function has no HTTP
 * request state so it can be called from controllers and BullMQ workers.
 */
export async function awardStudentBadge(
  input: AwardStudentBadgeInput
): Promise<AwardStudentBadgeResult> {
  const { badge, student, term, actor } = input

  if (!term) {
    return failure(404, 'No current academic term is available based on calendar dates')
  }
  if (!badge) return failure(404, 'BadgeDefinition not found')
  if (!student) return failure(404, 'Student not found')

  const calendar = await AcademicCalendar.findById(term.calendarId).lean()
  const schoolYear = normalizeYear(String(calendar?.academicYear ?? ''))
  if (!calendar || !/^\d{4}-\d{4}$/.test(schoolYear)) {
    return failure(404, 'No current academic term is available based on calendar dates')
  }

  if (actor.type === 'user') {
    try {
      if (actor.user.role === 'teacher') {
        await assertTeacherCanWriteStudent(actor.user.id, student._id)
      }
    } catch (error: any) {
      return failure(
        error?.statusCode || 403,
        error?.message || 'Forbidden: You cannot award this student'
      )
    }
  }

  const enrollment = await resolveCurrentBadgeEnrollment(
    student._id,
    schoolYear
  )

  if (!enrollment) {
    return failure(
      400,
      `Student is not enrolled in the current school year (${schoolYear})`
    )
  }

  const eligibleGrades = (badge.eligibleGrades ?? []).map(String)
  if (eligibleGrades.length === 0) {
    return failure(
      400,
      'Badge is not enabled for any grade yet; an admin must assign eligible grades first'
    )
  }
  if (!eligibleGrades.includes(String(enrollment.gradeId))) {
    return failure(400, "Student's grade is not eligible for this badge")
  }

  const termId = term._id

  if (actor.type === 'system') {
    const suppressed = await BadgeAwardSuppression.exists({
      studentId: student._id,
      badgeId: badge._id,
      academicTermId: termId,
    })
    if (suppressed) return { status: 'suppressed' }
  }

  const existing = await StudentBadge.findOne({
    badgeId: badge._id,
    studentId: student._id,
    academicTermId: termId,
  })
  if (existing) return { status: 'alreadyAwarded' }

  const source =
    actor.type === 'system'
      ? 'system'
      : actor.user.role === 'teacher'
        ? 'teacher'
        : 'admin'
  const awardedBy = actor.type === 'system' ? null : actor.user.id

  try {
    const award = await StudentBadge.create({
      badgeId: badge._id,
      studentId: student._id,
      schoolYear,
      academicTermId: termId,
      source,
      awardedBy,
      note: typeof input.note === 'string' ? input.note.trim() : '',
    })

    await notifyParent({ student, badge })
    return { status: 'created', award }
  } catch (error: any) {
    if (error?.code === 11000) return { status: 'alreadyAwarded' }
    throw error
  }
}
