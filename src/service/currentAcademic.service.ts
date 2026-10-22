/**
 * Central derived current-calendar/current-term service.
 *
 * `isCurrent` is never read from storage. It is computed from school-timezone
 * calendar dates:
 *   - current calendar: contains today, else most recently started, else none
 *   - current term: within the current calendar, contains today, else most
 *     recently started, else none
 */

import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { AcademicTerm } from '../models/academicTerm.model.js'
import {
  getAcademicDateStatus,
  getSchoolTimezone,
  toSchoolDateString,
  todaySchoolDate,
  type AcademicDateStatus,
} from '../utils/schoolDate.util.js'

export type AcademicPhase =
  | 'in-term'
  | 'between-terms'
  | 'before-first-term'
  | 'between-years'
  | 'none'

export interface CurrentAcademicSnapshot {
  today: string
  timeZone: string
  calendars: any[]
  currentCalendar: any | null
  currentTerm: any | null
  phase: AcademicPhase
}

function calendarDateRange(calendar: any, timeZone: string) {
  return {
    startDate: toSchoolDateString(calendar?.startDate, timeZone),
    endDate: toSchoolDateString(calendar?.endDate, timeZone),
  }
}

function termDateRange(term: any, timeZone: string) {
  return {
    startDate: toSchoolDateString(term?.startDate, timeZone),
    endDate: toSchoolDateString(term?.endDate, timeZone),
  }
}

function startedBeforeOrToday(calendar: any, today: string, timeZone: string): boolean {
  const { startDate } = calendarDateRange(calendar, timeZone)
  return !!startDate && startDate <= today
}

function pickCurrentCalendar(calendars: any[], today: string, timeZone: string): any | null {
  const containing = calendars.filter((calendar) => {
    const { startDate, endDate } = calendarDateRange(calendar, timeZone)
    return !!startDate && !!endDate && startDate <= today && today <= endDate
  })
  if (containing.length > 0) {
    return containing.sort((a, b) => {
      const aStart = calendarDateRange(a, timeZone).startDate ?? ''
      const bStart = calendarDateRange(b, timeZone).startDate ?? ''
      return bStart.localeCompare(aStart)
    })[0]
  }

  const started = calendars.filter((calendar) => startedBeforeOrToday(calendar, today, timeZone))
  if (started.length === 0) return null

  return started.sort((a, b) => {
    const aStart = calendarDateRange(a, timeZone).startDate ?? ''
    const bStart = calendarDateRange(b, timeZone).startDate ?? ''
    return bStart.localeCompare(aStart)
  })[0]
}

function pickCurrentTerm(terms: any[], today: string, timeZone: string): any | null {
  const containing = terms.filter((term) => {
    const { startDate, endDate } = termDateRange(term, timeZone)
    return !!startDate && !!endDate && startDate <= today && today <= endDate
  })
  if (containing.length > 0) {
    return containing.sort((a, b) => {
      const aStart = termDateRange(a, timeZone).startDate ?? ''
      const bStart = termDateRange(b, timeZone).startDate ?? ''
      return bStart.localeCompare(aStart)
    })[0]
  }

  const started = terms.filter((term) => {
    const { startDate } = termDateRange(term, timeZone)
    return !!startDate && startDate <= today
  })
  if (started.length === 0) return null

  return started.sort((a, b) => {
    const aStart = termDateRange(a, timeZone).startDate ?? ''
    const bStart = termDateRange(b, timeZone).startDate ?? ''
    return bStart.localeCompare(aStart)
  })[0]
}

function computePhase(
  calendars: any[],
  currentCalendar: any | null,
  currentTerm: any | null,
  terms: any[],
  today: string,
  timeZone: string
): AcademicPhase {
  if (calendars.length === 0) return 'none'

  if (!currentCalendar) {
    const hasUsableDates = calendars.some((calendar) => {
      const { startDate, endDate } = calendarDateRange(calendar, timeZone)
      return !!startDate || !!endDate
    })
    return hasUsableDates ? 'before-first-term' : 'none'
  }

  const { startDate: calendarStart, endDate: calendarEnd } =
    calendarDateRange(currentCalendar, timeZone)

  if (calendarStart && today < calendarStart) return 'before-first-term'
  if (calendarEnd && today > calendarEnd) return 'between-years'

  if (currentTerm) {
    const { startDate, endDate } = termDateRange(currentTerm, timeZone)
    if (startDate && endDate && startDate <= today && today <= endDate) {
      return 'in-term'
    }
  }

  const termStarts = terms
    .map((term) => termDateRange(term, timeZone).startDate)
    .filter((value): value is string => !!value)
    .sort()

  if (termStarts.length === 0) {
    return calendarStart && today < calendarStart ? 'before-first-term' : 'between-terms'
  }
  if (today < termStarts[0]) return 'before-first-term'
  return 'between-terms'
}

/** Loads calendars, the derived current calendar/term, and the current phase. */
export async function getCurrentAcademicSnapshot(): Promise<CurrentAcademicSnapshot> {
  const timeZone = await getSchoolTimezone()
  const today = todaySchoolDate(timeZone)

  let calendars: any[] = []
  try {
    calendars = await AcademicCalendar.find().lean()
  } catch {
    calendars = []
  }

  const currentCalendar = pickCurrentCalendar(calendars, today, timeZone)

  let terms: any[] = []
  if (currentCalendar) {
    try {
      terms = await AcademicTerm.find({ calendarId: currentCalendar._id }).lean()
    } catch {
      terms = []
    }
  }

  const currentTerm = currentCalendar
    ? pickCurrentTerm(terms, today, timeZone)
    : null

  return {
    today,
    timeZone,
    calendars,
    currentCalendar,
    currentTerm,
    phase: computePhase(
      calendars,
      currentCalendar,
      currentTerm,
      terms,
      today,
      timeZone
    ),
  }
}

/** The derived current calendar, or null. */
export async function getCurrentCalendar(): Promise<any | null> {
  const snapshot = await getCurrentAcademicSnapshot()
  return snapshot.currentCalendar
}

/** The derived current term (within the current calendar), or null. */
export async function getCurrentTerm(): Promise<any | null> {
  const snapshot = await getCurrentAcademicSnapshot()
  return snapshot.currentTerm
}

/** Adds computed `status` and `isCurrent` to a calendar document/object. */
export function decorateCalendarRecord(calendar: any, snapshot: CurrentAcademicSnapshot): any {
  if (!calendar) return null
  const obj = typeof calendar.toObject === 'function' ? calendar.toObject() : { ...calendar }
  const { startDate, endDate } = calendarDateRange(obj, snapshot.timeZone)
  const status: AcademicDateStatus = getAcademicDateStatus(
    startDate,
    endDate,
    snapshot.today
  )
  return {
    ...obj,
    status,
    isCurrent:
      !!snapshot.currentCalendar &&
      String(snapshot.currentCalendar._id) === String(obj._id),
  }
}

/** Adds computed `status` and `isCurrent` to a term document/object. */
export function decorateTermRecord(term: any, snapshot: CurrentAcademicSnapshot): any {
  if (!term) return null
  const obj = typeof term.toObject === 'function' ? term.toObject() : { ...term }
  const { startDate, endDate } = termDateRange(obj, snapshot.timeZone)
  const status: AcademicDateStatus = getAcademicDateStatus(
    startDate,
    endDate,
    snapshot.today
  )
  return {
    ...obj,
    status,
    isCurrent:
      !!snapshot.currentTerm &&
      String(snapshot.currentTerm._id) === String(obj._id),
  }
}

/** Converts a calendar/term document to its date strings for API use. */
export function academicDateRange(record: any, timeZone: string) {
  return {
    startDate: toSchoolDateString(record?.startDate, timeZone),
    endDate: toSchoolDateString(record?.endDate, timeZone),
  }
}
