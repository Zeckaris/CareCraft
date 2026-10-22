import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { AcademicTerm } from '../models/academicTerm.model.js'
import { ScheduleSetting } from '../models/scheduleSetting.model.js'
import { getCurrentCalendar } from './currentAcademic.service.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'
import {
  DEFAULT_ENABLED_DAYS,
  type ScheduleDay,
} from '../utils/scheduleSetting.util.js'
import {
  addDaysSchoolDate,
  getSchoolTimezone,
  isSchoolDateString,
  toSchoolDateString,
  todaySchoolDate,
} from '../utils/schoolDate.util.js'

type WeekdayKey = ScheduleDay | 'sunday'

const DAY_INDEX: Record<WeekdayKey, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const DEFAULT_WORKING_DAYS = new Set(
  DEFAULT_ENABLED_DAYS.map((day) => DAY_INDEX[day])
)

export interface SchoolDayResult {
  isSchoolDay: boolean
  reason: string | null
  academicTermId: string | null
}

export interface SchoolDayContext {
  schoolYear: string
  calendar: any
  terms: any[]
  timeZone: string
  today: string
  calendarStart: string
  calendarEnd: string
  holidayDates: Set<string>
  workingDays: Set<number>
  isSchoolDay(date: string): SchoolDayResult
  previousSchoolDay(beforeDate: string): string | null
}

export type LoadSchoolDayContextResult =
  | { ok: true; context: SchoolDayContext }
  | { ok: false; status: 400; message: string }

function buildWorkingDays(setting: any): Set<number> {
  const configured = Array.isArray(setting?.enabledDays) && setting.enabledDays.length > 0
    ? setting.enabledDays
    : DEFAULT_ENABLED_DAYS

  const workingDays = new Set<number>()
  for (const value of configured) {
    const day = String(value).toLowerCase() as WeekdayKey
    const index = DAY_INDEX[day]
    if (typeof index === 'number') workingDays.add(index)
  }

  return workingDays.size > 0 ? workingDays : new Set(DEFAULT_WORKING_DAYS)
}

function createContext(params: {
  calendar: any
  terms: any[]
  setting: any
  timeZone: string
  today: string
  calendarStart: string
  calendarEnd: string
  schoolYear: string
}): SchoolDayContext {
  const {
    calendar,
    terms,
    setting,
    timeZone,
    today,
    calendarStart,
    calendarEnd,
    schoolYear,
  } = params

  const holidayDates = new Set<string>()
  for (const holiday of calendar.holidayDates ?? []) {
    const value = toSchoolDateString(holiday, timeZone)
    if (value) holidayDates.add(value)
  }

  const termRanges: Array<{ term: any; startDate: string; endDate: string }> = []
  for (const term of terms) {
    const startDate = toSchoolDateString(term.startDate, timeZone)
    const endDate = toSchoolDateString(term.endDate, timeZone)
    if (startDate && endDate) termRanges.push({ term, startDate, endDate })
  }
  termRanges.sort((a, b) => b.startDate.localeCompare(a.startDate))

  const workingDays = buildWorkingDays(setting)

  const findTerm = (date: string): any | null =>
    termRanges.find((entry) => entry.startDate <= date && date <= entry.endDate)?.term ?? null

  const evaluate = (date: string, rejectFuture: boolean): SchoolDayResult => {
    if (!isSchoolDateString(date)) {
      return {
        isSchoolDay: false,
        reason: 'date must be a valid YYYY-MM-DD date',
        academicTermId: null,
      }
    }

    const term = findTerm(date)
    const academicTermId = term ? String(term._id) : null

    if (rejectFuture && date > today) {
      return {
        isSchoolDay: false,
        reason: 'Cannot record attendance for a future date',
        academicTermId,
      }
    }

    if (date < calendarStart || date > calendarEnd) {
      return {
        isSchoolDay: false,
        reason: `${date} is outside the academic calendar (${calendarStart} – ${calendarEnd})`,
        academicTermId: null,
      }
    }

    if (!term) {
      return {
        isSchoolDay: false,
        reason:
          terms.length === 0
            ? `${date} cannot be recorded because no academic term is defined for ${calendar.academicYear}`
            : `${date} falls between academic terms for ${calendar.academicYear}; attendance can only be recorded on a term date`,
        academicTermId: null,
      }
    }

    if (holidayDates.has(date)) {
      return {
        isSchoolDay: false,
        reason: `${date} is a holiday – attendance cannot be recorded`,
        academicTermId,
      }
    }

    const [year, month, day] = date.split('-').map(Number)
    const dayOfWeek = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay()
    if (!workingDays.has(dayOfWeek)) {
      return {
        isSchoolDay: false,
        reason: `${date} is a ${DAY_LABELS[dayOfWeek]} – not a school day`,
        academicTermId,
      }
    }

    return { isSchoolDay: true, reason: null, academicTermId }
  }

  const previousSchoolDay = (beforeDate: string): string | null => {
    if (!isSchoolDateString(beforeDate)) return null

    let cursor = addDaysSchoolDate(beforeDate, -1)
    if (!cursor) return null
    if (cursor > calendarEnd) cursor = calendarEnd

    while (cursor && cursor >= calendarStart) {
      if (evaluate(cursor, false).isSchoolDay) return cursor
      cursor = addDaysSchoolDate(cursor, -1)
    }

    return null
  }

  return {
    schoolYear,
    calendar,
    terms,
    timeZone,
    today,
    calendarStart,
    calendarEnd,
    holidayDates,
    workingDays,
    isSchoolDay: (date: string) => evaluate(date, true),
    previousSchoolDay,
  }
}

export async function loadSchoolDayContext(
  schoolYearInput?: string
): Promise<LoadSchoolDayContextResult> {
  const timeZone = await getSchoolTimezone()
  const today = todaySchoolDate(timeZone)

  let calendar: any = null
  if (schoolYearInput) {
    calendar = await AcademicCalendar.findOne({
      academicYear: { $in: getYearVariants(schoolYearInput) },
    }).lean()

    if (!calendar) {
      return {
        ok: false,
        status: 400,
        message: `No academic calendar found for school year "${schoolYearInput}"`,
      }
    }
  } else {
    calendar = await getCurrentCalendar()
    if (!calendar) {
      return {
        ok: false,
        status: 400,
        message: 'No current academic calendar found',
      }
    }
  }

  const calendarStart = toSchoolDateString(calendar.startDate, timeZone)
  const calendarEnd = toSchoolDateString(calendar.endDate, timeZone)
  if (!calendarStart || !calendarEnd) {
    return {
      ok: false,
      status: 400,
      message: `Academic calendar ${calendar.academicYear ?? ''} has invalid start or end dates`,
    }
  }

  const [terms, setting] = await Promise.all([
    AcademicTerm.find({ calendarId: calendar._id }).lean(),
    ScheduleSetting.findOne({
      schoolYear: { $in: getYearVariants(calendar.academicYear) },
    })
      .select('enabledDays')
      .lean(),
  ])

  const schoolYear = normalizeYear(String(calendar.academicYear))

  return {
    ok: true,
    context: createContext({
      calendar,
      terms,
      setting,
      timeZone,
      today,
      calendarStart,
      calendarEnd,
      schoolYear,
    }),
  }
}
