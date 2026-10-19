/**
 * attendanceDateValidator.ts
 *
 * Centralises all date-validation rules for attendance:
 *   - No future dates
 *   - Must fall within an academic calendar
 *   - Must fall inside an academic term of that calendar
 *   - Must not be a holiday listed in that calendar
 *   - Must be a working school day (Mon–Fri by default, or per SchoolInfo)
 *
 * All dates are calendar-date strings in the school timezone from
 * SchoolInfo.timezone (default Africa/Addis_Ababa).
 */

import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { AcademicTerm } from '../models/academicTerm.model.js'
import { SchoolInfo } from '../models/schoolInfo.model.js'
import { getYearVariants } from '../utils/yearNormalizer.js'
import { getCurrentCalendar } from './currentAcademic.service.js'
import {
  getSchoolTimezone,
  isSchoolDateString,
  toSchoolDateString,
  todaySchoolDate,
} from '../utils/schoolDate.util.js'

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
  const raw: string[] | undefined = (info as any)?.workingDays
  if (raw && Array.isArray(raw) && raw.length > 0) {
    const days = new Set<number>()
    for (const d of raw) {
      const n = DAY_NAMES[d.toLowerCase()]
      if (n !== undefined) days.add(n)
    }
    return days
  }
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
  /** The term whose dates contain the attendance date. */
  term?: any
}

/**
 * Validates that `dateStr` (YYYY-MM-DD) is a legal attendance date.
 *
 * @param dateStr  YYYY-MM-DD in the school's calendar-date space
 * @param schoolYear  Optional – if supplied the calendar for that year is used;
 *                    otherwise the derived current calendar is used.
 */
export async function validateAttendanceDate(
  dateStr: string,
  schoolYear?: string
): Promise<DateValidationResult> {
  // ── 1. Basic format & parseability ────────────────────────────────────────
  if (!isSchoolDateString(dateStr)) {
    return { valid: false, error: 'date must be a valid YYYY-MM-DD date' }
  }

  const timeZone = await getSchoolTimezone()
  const today = todaySchoolDate(timeZone)

  // ── 2. No future dates ────────────────────────────────────────────────────
  if (dateStr > today) {
    return { valid: false, error: 'Cannot record attendance for a future date' }
  }

  // ── 3. Academic calendar bounds ───────────────────────────────────────────
  let cal: any = null
  if (schoolYear) {
    cal = await AcademicCalendar.findOne({
      academicYear: { $in: getYearVariants(schoolYear) },
    }).lean()
  } else {
    cal = await getCurrentCalendar()
  }

  if (!cal) {
    return {
      valid: false,
      error: schoolYear
        ? `No academic calendar found for school year "${schoolYear}"`
        : 'No current academic calendar found',
    }
  }

  const calStart = toSchoolDateString(cal.startDate, timeZone)
  const calEnd = toSchoolDateString(cal.endDate, timeZone)
  if (!calStart || !calEnd) {
    return {
      valid: false,
      error: `Academic calendar ${cal.academicYear ?? ''} has invalid start or end dates`,
    }
  }

  if (dateStr < calStart || dateStr > calEnd) {
    return {
      valid: false,
      error: `${dateStr} is outside the academic calendar (${calStart} – ${calEnd})`,
    }
  }

  // ── 4. Term containment ───────────────────────────────────────────────────
  const terms = await AcademicTerm.find({ calendarId: cal._id }).lean()
  const containingTerms = terms
    .map((term) => {
      const startDate = toSchoolDateString(term.startDate, timeZone)
      const endDate = toSchoolDateString(term.endDate, timeZone)
      return { term, startDate, endDate }
    })
    .filter(
      (entry) =>
        !!entry.startDate &&
        !!entry.endDate &&
        entry.startDate <= dateStr &&
        dateStr <= entry.endDate
    )
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))

  if (containingTerms.length === 0) {
    return {
      valid: false,
      error:
        terms.length === 0
          ? `${dateStr} cannot be recorded because no academic term is defined for ${cal.academicYear}`
          : `${dateStr} falls between academic terms for ${cal.academicYear}; attendance can only be recorded on a term date`,
    }
  }
  const term = containingTerms[0].term

  // ── 5. Holiday check ──────────────────────────────────────────────────────
  const holidayStrings = (cal.holidayDates ?? [])
    .map((holiday: any) => toSchoolDateString(holiday, timeZone))
    .filter((value: string | null): value is string => !!value)
  if (holidayStrings.includes(dateStr)) {
    return { valid: false, error: `${dateStr} is a holiday – attendance cannot be recorded` }
  }

  // ── 6. Working day ────────────────────────────────────────────────────────
  const [yr, mo, dy] = dateStr.split('-').map(Number)
  const dayOfWeek = new Date(Date.UTC(yr, mo - 1, dy, 12, 0, 0)).getUTCDay()
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
    term,
  }
}
