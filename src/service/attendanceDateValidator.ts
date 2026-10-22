import { loadSchoolDayContext } from './schoolDay.service.js'

export interface DateValidationResult {
  valid: boolean
  error?: string
  calendar?: {
    academicYear: string
    startDate: Date
    endDate: Date
    holidayDates: Date[]
  }
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
  const loaded = await loadSchoolDayContext(schoolYear)
  if (!loaded.ok) {
    return { valid: false, error: loaded.message }
  }

  const { context } = loaded
  const outcome = context.isSchoolDay(dateStr)
  if (!outcome.isSchoolDay) {
    return { valid: false, error: outcome.reason ?? 'Invalid attendance date' }
  }

  const term = outcome.academicTermId
    ? context.terms.find((entry) => String(entry._id) === outcome.academicTermId)
    : undefined

  return {
    valid: true,
    calendar: {
      academicYear: context.calendar.academicYear,
      startDate: context.calendar.startDate,
      endDate: context.calendar.endDate,
      holidayDates: context.calendar.holidayDates ?? [],
    },
    term,
  }
}
