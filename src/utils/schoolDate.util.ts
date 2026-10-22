/**
 * School calendar-date utilities.
 *
 * Calendar dates (calendar/term/registration/holiday dates and attendance
 * dates) are represented as YYYY-MM-DD strings in the school's timezone.
 * Storage uses UTC midnight of that calendar date.
 *
 * Legacy rows may store either:
 *   - 00:00:00.000Z on the intended date, or
 *   - 21:00:00.000Z on the previous date (school midnight in UTC+3).
 * Both forms resolve to the intended YYYY-MM-DD string below.
 */

import { SchoolInfo } from '../models/schoolInfo.model.js'

export const DEFAULT_SCHOOL_TIMEZONE = 'Africa/Addis_Ababa'

export type AcademicDateStatus = 'upcoming' | 'current' | 'past'

let cachedTimezone: string | null = null

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 24 * 60 * 60 * 1000

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

/** Reads the school timezone from SchoolInfo, defaulting to Addis Ababa. */
export async function getSchoolTimezone(): Promise<string> {
  if (cachedTimezone) return cachedTimezone
  try {
    const info = await SchoolInfo.findOne().select('timezone').lean()
    const candidate = typeof (info as any)?.timezone === 'string'
      ? (info as any).timezone.trim()
      : ''
    cachedTimezone = candidate && isValidTimeZone(candidate)
      ? candidate
      : DEFAULT_SCHOOL_TIMEZONE
  } catch {
    cachedTimezone = DEFAULT_SCHOOL_TIMEZONE
  }
  return cachedTimezone ?? DEFAULT_SCHOOL_TIMEZONE
}

/** True when value is a real YYYY-MM-DD calendar date. */
export function isSchoolDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_ONLY_RE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  )
}

function utcDateString(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Converts a stored value to its school-timezone YYYY-MM-DD date string.
 * Returns null for missing/invalid values; never throws.
 */
export function toSchoolDateString(
  value: Date | string | number | null | undefined,
  timeZone: string = DEFAULT_SCHOOL_TIMEZONE
): string | null {
  if (value === null || value === undefined || value === '') return null

  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null

  // Legacy date-only storage: UTC midnight represents the intended date.
  if (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    return utcDateString(d)
  }

  // Legacy school-midnight storage: 21:00Z represents the following date.
  if (
    d.getUTCHours() === 21 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  ) {
    return utcDateString(new Date(d.getTime() + 3 * 60 * 60 * 1000))
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d)
    const get = (type: string) => parts.find((p) => p.type === type)?.value
    const year = get('year')
    const month = get('month')
    const day = get('day')
    if (!year || !month || !day) return null
    return `${year}-${month}-${day}`
  } catch {
    return null
  }
}

/** Today's calendar date in the school timezone. */
export function todaySchoolDate(timeZone: string = DEFAULT_SCHOOL_TIMEZONE): string {
  return toSchoolDateString(new Date(), timeZone) ?? utcDateString(new Date())
}

/**
 * Normalizes user input to UTC midnight of the intended school date.
 * Accepts date-only strings or ISO instants (interpreted in the school
 * timezone). Returns null for invalid input.
 */
export function normalizeSchoolDateInput(
  value: unknown,
  timeZone: string = DEFAULT_SCHOOL_TIMEZONE
): Date | null {
  if (value === null || value === undefined || value === '') return null

  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    if (!isSchoolDateString(value)) return null
    const [year, month, day] = value.split('-').map(Number)
    return new Date(Date.UTC(year, month - 1, day))
  }

  const dateString = toSchoolDateString(
    value as Date | string | number,
    timeZone
  )
  if (!dateString) return null
  const [year, month, day] = dateString.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

/** Adds whole days to a YYYY-MM-DD date string. */
export function addDaysSchoolDate(dateString: string, days: number): string | null {
  if (!isSchoolDateString(dateString) || !Number.isInteger(days)) return null
  const [year, month, day] = dateString.split('-').map(Number)
  return utcDateString(new Date(Date.UTC(year, month - 1, day) + days * DAY_MS))
}

/** Inclusive start/end status relative to a YYYY-MM-DD date. */
export function getAcademicDateStatus(
  startDate: string | null,
  endDate: string | null,
  today: string
): AcademicDateStatus {
  if (!startDate && !endDate) return 'past'
  if (startDate && today < startDate) return 'upcoming'
  if (endDate && today > endDate) return 'past'
  return 'current'
}
