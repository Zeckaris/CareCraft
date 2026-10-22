import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { getCurrentAcademicSnapshot, type CurrentAcademicSnapshot } from './currentAcademic.service.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'

export const NO_CURRENT_TERM_MESSAGE =
  'No current academic term is available based on calendar dates'

export interface BadgeWindow {
  snapshot: CurrentAcademicSnapshot
  term: any | null
  schoolYear: string | null
}

/**
 * Resolves the window used by manual awards, the badge evaluator, the worker,
 * and the progress endpoint. The current term is derived exactly like manual
 * awards: most recently started term, with no grace window.
 */
export async function resolveCurrentBadgeWindow(): Promise<BadgeWindow> {
  const snapshot = await getCurrentAcademicSnapshot()
  const term = snapshot.currentTerm
  const schoolYear = normalizeYear(
    String(snapshot.currentCalendar?.academicYear ?? '')
  )
  return {
    snapshot,
    term,
    schoolYear: /^\d{4}-\d{4}$/.test(schoolYear) ? schoolYear : null,
  }
}

/** Active enrollment for the student in the badge window's school year. */
export async function resolveCurrentBadgeEnrollment(
  studentId: any,
  schoolYear: string
): Promise<any | null> {
  return StudentEnrollment.findOne({
    studentId,
    schoolYear: { $in: getYearVariants(schoolYear) },
    isActive: true,
  })
    .sort({ isActive: -1, createdAt: -1 })
    .lean()
}
