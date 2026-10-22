/**
 * Single source of truth for badge criteria types and scopes.
 *
 * Every criteria type is automatic: a badge with no criteria is
 * teacher-awarded only, and a badge that has criteria is evaluated by the
 * background worker.
 */

export const BADGE_CRITERIA_TYPES = [
  'attributeAverage',
  'attendanceRate',
  'attendanceStreak',
  'academicAverage',
  'academicImprovement',
  'academicConsistency',
] as const

export type BadgeCriteriaType = (typeof BADGE_CRITERIA_TYPES)[number]

export const BADGE_CRITERIA_SCOPES = ['term', 'year'] as const

export type BadgeCriteriaScope = (typeof BADGE_CRITERIA_SCOPES)[number]

export const BADGE_STREAK_MODES = ['noAbsence', 'onTime'] as const

export type BadgeStreakMode = (typeof BADGE_STREAK_MODES)[number]

export const BADGE_CRITERIA_TYPE_LABELS: Record<BadgeCriteriaType, string> = {
  attributeAverage: 'Attribute evaluation average',
  attendanceRate: 'Attendance rate',
  attendanceStreak: 'Attendance streak',
  academicAverage: 'Academic average',
  academicImprovement: 'Academic improvement',
  academicConsistency: 'Academic consistency',
}

/**
 * Semantics shared by validation, the evaluator and the frontend contract.
 */
export const BADGE_CRITERIA_TYPE_DESCRIPTIONS: Record<BadgeCriteriaType, string> = {
  attributeAverage:
    'Average attribute evaluation score, optionally limited to one category; blank category means all categories. Requires minEvaluationCount evaluations in the window.',
  attendanceRate:
    'Attendance percentage for badge evaluation where excused absences count as absences. Requires minRecordedSchoolDays recorded school days in the window.',
  attendanceStreak:
    'Longest run of recorded school days without an absence (noAbsence) or without a late arrival and without an absence (onTime) in the current term. Days with no record are skipped.',
  academicAverage:
    'Average percentage across locked assessment stages. Only evaluated once every assessment stage in the relevant setup is locked for every term in scope.',
  academicImprovement:
    'Percentage-point change in the overall academic average between the current term and the previous term of the same academic year. Both terms must be fully locked.',
  academicConsistency:
    'Every subject with a setup for the current term is fully locked and the student average in each of those subjects is at least minPercentage.',
}

/**
 * Minimum-data defaults applied by the phase-1 migration to existing automatic
 * criteria that predate the minimum-data guard. Kept for the phase-1 migration;
 * academicAverage no longer uses minLockedWeightPercentage.
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

export const BADGE_STREAK_MODE_LABELS: Record<BadgeStreakMode, string> = {
  noAbsence: 'No absence',
  onTime: 'On time (no late arrival and no absence)',
}

/** Every criteria type can be awarded automatically. */
export const AUTOMATIC_CRITERIA_TYPES: readonly BadgeCriteriaType[] = [
  ...BADGE_CRITERIA_TYPES,
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

export function isBadgeStreakMode(value: unknown): value is BadgeStreakMode {
  return (
    typeof value === 'string' &&
    (BADGE_STREAK_MODES as readonly string[]).includes(value)
  )
}

export function isAutomaticCriteriaType(type: BadgeCriteriaType): boolean {
  return AUTOMATIC_CRITERIA_TYPES.includes(type)
}

export const BADGE_CRITERIA_TYPE_LIST = BADGE_CRITERIA_TYPES.join(', ')

export const BADGE_STREAK_MODE_LIST = BADGE_STREAK_MODES.join(', ')
