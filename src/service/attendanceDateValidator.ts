/**
 * attendanceDateValidator.ts
 *
 * Centralises all date-validation rules for attendance:
 *   - No future dates
 *   - Must fall within an active academic calendar
 *   - Must not be a holiday listed in that calendar
 *   - Must be a working school day (Mon–Fri by default, or per SchoolInfo)
 *
 * The school is in Africa/Addis_Ababa (UTC+3, no DST).
 * We treat a "calendar date" as a YYYY-MM-DD string derived from the local
 * Addis Ababa clock so that midnight UTC does not drift the date back by one.
 */

import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { SchoolInfo } from '../models/schoolInfo.model.js'
import { getYearVariants } from '../utils/yearNormalizer.js'

const TZ = 'Africa/Addis_Ababa'

/**
 * Returns today's date in YYYY-MM-DD format as seen in Addis Ababa.
 */
export function todayEAT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

/**
 * Converts any Date object to a YYYY-MM-DD string in Addis Ababa time.
 */
export function toEATDateString(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TZ })
}

/** Mapping from school-days string keys to JS day-of-week (0=Sun, 6=Sat). */
const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

/**
 * Returns the set of working day-of-week numbers (0=Sun … 6=Sat).
 * Defaults to Mon–Fri if SchoolInfo has no workingDays field.
 */
async function getWorkingDays(): Promise<Set<number>> {
  const info = await SchoolInfo.findOne().select('workingDays').lean()
  // workingDays is an optional array of day-name strings on SchoolInfo.
  // If it doesn't exist in the schema yet, fall back to Mon–Fri.
  const raw: string[] | undefined = (info as any)?.workingDays
  if (raw && Array.isArray(raw) && raw.length > 0) {
    const days = new Set<number>()
    for (const d of raw) {
      const n = DAY_NAMES[d.toLowerCase()]
      if (n !== undefined) days.add(n)
    }
    return days
  }
  // Default: Monday (1) through Friday (5)
  return new Set([1, 2, 3, 4, 5])
}

export interface DateValidationResult {
  valid: boolean
  error?: string
  /** The resolved calendar, exposed so callers can also read schoolYear. */
  calendar?: {
    academicYear: string
    startDate: Date
    endDate: Date
    holidayDates: Date[]
  }
}

/**
 * Validates that `dateStr` (YYYY-MM-DD) is a legal attendance date:
 *   1. Parseable date
 *   2. Not in the future (vs today in Addis Ababa)
 *   3. Falls within the active academic calendar bounds
 *   4. Is not a listed holiday
 *   5. Is a working school day
 *
 * @param dateStr  YYYY-MM-DD – already assumed to be in EAT local date space
 * @param schoolYear  Optional – if supplied the calendar for that year is used;
 *                    otherwise the currently active calendar is used.
 */
export async function validateAttendanceDate(
  dateStr: string,
  schoolYear?: string
): Promise<DateValidationResult> {
  // ── 1. Basic format & parseability ────────────────────────────────────────
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, error: 'date must be in YYYY-MM-DD format' }
  }
  const [yr, mo, dy] = dateStr.split('-').map(Number)
  // Construct the Date at noon UTC so local-day arithmetic stays unambiguous
  const dateObj = new Date(Date.UTC(yr, mo - 1, dy, 12, 0, 0))
  if (isNaN(dateObj.getTime())) {
    return { valid: false, error: `"${dateStr}" is not a valid calendar date` }
  }

  // ── 2. No future dates ────────────────────────────────────────────────────
  const today = todayEAT()
  if (dateStr > today) {
    return { valid: false, error: 'Cannot record attendance for a future date' }
  }

  // ── 3. Academic calendar bounds ───────────────────────────────────────────
  const calFilter: any = schoolYear
    ? { academicYear: { $in: getYearVariants(schoolYear) } }
    : { isCurrent: true }

  const cal = await AcademicCalendar.findOne(calFilter).lean()
  if (!cal) {
    return {
      valid: false,
      error: schoolYear
        ? `No academic calendar found for school year "${schoolYear}"`
        : 'No active academic calendar found',
    }
  }

  const calStart = toEATDateString(cal.startDate)
  const calEnd   = toEATDateString(cal.endDate)

  if (dateStr < calStart || dateStr > calEnd) {
    return {
      valid: false,
      error: `${dateStr} is outside the academic calendar (${calStart} – ${calEnd})`,
    }
  }

  // ── 4. Holiday check ──────────────────────────────────────────────────────
  const holidayStrings = cal.holidayDates.map((h) => toEATDateString(h))
  if (holidayStrings.includes(dateStr)) {
    return { valid: false, error: `${dateStr} is a holiday – attendance cannot be recorded` }
  }

  // ── 5. Working day ────────────────────────────────────────────────────────
  // dateObj was built at UTC noon; its UTC day-of-week is correct for the
  // Addis Ababa date (UTC+3 means UTC noon is 3 PM local – same calendar day).
  const dayOfWeek = dateObj.getUTCDay()
  const workingDays = await getWorkingDays()
  if (!workingDays.has(dayOfWeek)) {
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      dayOfWeek
    ]
    return { valid: false, error: `${dateStr} is a ${dayName} – not a school day` }
  }

  return {
    valid: true,
    calendar: {
      academicYear: cal.academicYear,
      startDate: cal.startDate,
      endDate: cal.endDate,
      holidayDates: cal.holidayDates,
    },
  }
}
