/**
 * Single source of truth for badge criteria types and scopes.
 *
 * Phase 1 only stores and validates criteria. Evaluation is intentionally out
 * of scope until phase 2, so `isAutomatic` describes whether a future
 * evaluator could award the badge without a manual action.
 */

export const BADGE_CRITERIA_TYPES = [
  'attributeAverage',
  'attendanceRate',
  'academicAverage',
  'custom',
] as const

export type BadgeCriteriaType = (typeof BADGE_CRITERIA_TYPES)[number]

export const BADGE_CRITERIA_SCOPES = ['term', 'year'] as const

export type BadgeCriteriaScope = (typeof BADGE_CRITERIA_SCOPES)[number]

export const BADGE_CRITERIA_TYPE_LABELS: Record<BadgeCriteriaType, string> = {
  attributeAverage: 'Attribute evaluation average',
  attendanceRate: 'Attendance rate',
  academicAverage: 'Academic average',
  custom: 'Custom (manual)',
}

/**
 * Semantics reserved for the phase-2 evaluator. Kept next to the type list so
 * validation and evaluation cannot drift apart.
 */
export const BADGE_CRITERIA_TYPE_DESCRIPTIONS: Record<BadgeCriteriaType, string> = {
  attributeAverage:
    'Average attribute evaluation score, optionally limited to one category; blank category means all categories. Requires minEvaluationCount evaluations in the window.',
  attendanceRate:
    'Attendance percentage where excused absences are excluded from the denominator and late still counts as attended. Requires minRecordedSchoolDays recorded school days in the window.',
  academicAverage:
    'Average percentage across locked assessment stages only, matching the dashboard rule. Requires minLockedWeightPercentage of the total assessment weight to be locked in the window.',
  custom: 'Manually awarded by a homeroom teacher or administrator; never auto-awarded.',
}

/**
 * Minimum-data defaults applied by the phase-1 migration to existing automatic
 * criteria that predate the minimum-data guard. New criteria must supply the
 * value explicitly.
 */
export const BADGE_CRITERIA_MIN_DATA_DEFAULTS = {
  attributeAverage: { minEvaluationCount: 3 },
  attendanceRate: { minRecordedSchoolDays: 10 },
  academicAverage: { minLockedWeightPercentage: 50 },
} as const

export const BADGE_CRITERIA_SCOPE_LABELS: Record<BadgeCriteriaScope, string> = {
  term: 'Current term',
  year: 'Current school year',
}

/** Types a background evaluator may award automatically in phase 2. */
export const AUTOMATIC_CRITERIA_TYPES: readonly BadgeCriteriaType[] = [
  'attributeAverage',
  'attendanceRate',
  'academicAverage',
]

export function isBadgeCriteriaType(value: unknown): value is BadgeCriteriaType {
  return (
    typeof value === 'string' &&
    (BADGE_CRITERIA_TYPES as readonly string[]).includes(value)
  )
}

export function isBadgeCriteriaScope(value: unknown): value is BadgeCriteriaScope {
  return (
    typeof value === 'string' &&
    (BADGE_CRITERIA_SCOPES as readonly string[]).includes(value)
  )
}

export function isAutomaticCriteriaType(type: BadgeCriteriaType): boolean {
  return AUTOMATIC_CRITERIA_TYPES.includes(type)
}

export const BADGE_CRITERIA_TYPE_LIST = BADGE_CRITERIA_TYPES.join(', ')
