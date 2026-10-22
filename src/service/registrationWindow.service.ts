/**
 * Registration-window rules shared by enrollment writes and the window-read
 * endpoint.
 *
 * A student is "new" when they have no earlier enrollment record at all.
 * New students use the new-student window; everyone else uses the general
 * window. Date comparisons are inclusive YYYY-MM-DD strings in the school
 * timezone.
 */

import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import {
  decorateCalendarRecord,
  getCurrentAcademicSnapshot,
  getCurrentCalendar,
} from './currentAcademic.service.js'
import {
  getSchoolTimezone,
  isSchoolDateString,
  toSchoolDateString,
  todaySchoolDate,
} from '../utils/schoolDate.util.js'
import { getYearVariants, normalizeYear, yearsMatch } from '../utils/yearNormalizer.js'

export type RegistrationWindowType = 'general' | 'new-student'

export interface RegistrationWindowInfo {
  startDate: string | null
  endDate: string | null
  configured: boolean
  isOpen: boolean
}

export interface CalendarRegistrationWindows {
  calendar: any
  calendarId: string
  academicYear: string
  startDate: string | null
  endDate: string | null
  status: 'upcoming' | 'current' | 'past'
  general: RegistrationWindowInfo
  newStudent: RegistrationWindowInfo
}

function windowFields(type: RegistrationWindowType) {
  return type === 'new-student'
    ? {
        start: 'newStudentRegistrationStartDate',
        end: 'newStudentRegistrationEndDate',
        label: 'new-student registration',
      }
    : {
        start: 'registrationStartDate',
        end: 'registrationEndDate',
        label: 'general registration',
      }
}

function displayYear(calendar: any): string {
  const raw = typeof calendar?.academicYear === 'string' ? calendar.academicYear : ''
  return raw ? normalizeYear(raw) : 'unknown'
}

export function getRegistrationWindow(
  calendar: any,
  type: RegistrationWindowType,
  timeZone: string,
  today: string
): RegistrationWindowInfo {
  const fields = windowFields(type)
  const startDate = toSchoolDateString(calendar?.[fields.start], timeZone)
  const endDate = toSchoolDateString(calendar?.[fields.end], timeZone)
  const configured = !!startDate && !!endDate
  return {
    startDate,
    endDate,
    configured,
    isOpen: configured && startDate <= today && today <= endDate,
  }
}

export function getRegistrationWindowsForCalendar(
  calendar: any,
  timeZone: string,
  today: string
): CalendarRegistrationWindows {
  const calendarStart = toSchoolDateString(calendar?.startDate, timeZone)
  const calendarEnd = toSchoolDateString(calendar?.endDate, timeZone)
  const status =
    calendarStart && today < calendarStart
      ? 'upcoming'
      : calendarEnd && today > calendarEnd
        ? 'past'
        : 'current'

  return {
    calendar,
    calendarId: String(calendar?._id),
    academicYear: displayYear(calendar),
    startDate: calendarStart,
    endDate: calendarEnd,
    status,
    general: getRegistrationWindow(calendar, 'general', timeZone, today),
    newStudent: getRegistrationWindow(calendar, 'new-student', timeZone, today),
  }
}

/** True when the student has no earlier enrollment record. */
export async function isNewStudent(
  studentId: any,
  excludeEnrollmentId?: any
): Promise<boolean> {
  const filter: any = { studentId }
  if (excludeEnrollmentId) filter._id = { $ne: excludeEnrollmentId }
  const count = await StudentEnrollment.countDocuments(filter)
  return count === 0
}

/** Earliest configured window of this type that opens after today. */
export async function getNextWindowOpening(
  type: RegistrationWindowType,
  timeZone: string,
  today: string
): Promise<string | null> {
  let calendars: any[] = []
  try {
    calendars = await AcademicCalendar.find().lean()
  } catch {
    return null
  }

  let next: string | null = null
  for (const calendar of calendars) {
    const window = getRegistrationWindow(calendar, type, timeZone, today)
    if (!window.startDate || window.startDate <= today) continue
    if (!next || window.startDate < next) next = window.startDate
  }
  return next
}

function windowLabel(type: RegistrationWindowType): string {
  return windowFields(type).label
}

function closedWindowMessage(
  academicYear: string,
  type: RegistrationWindowType,
  window: RegistrationWindowInfo,
  nextOpening: string | null
): string {
  const label = windowLabel(type)
  const detail = window.configured
    ? `The ${label} window was ${window.startDate} to ${window.endDate}.`
    : `No ${label} window is configured for ${academicYear}.`
  const next = nextOpening
    ? ` The next ${label} window opens on ${nextOpening}.`
    : ''
  return `Registration is closed for ${academicYear}. ${detail}${next}`
}

function noOpenWindowMessage(
  type: RegistrationWindowType,
  nextOpening: string | null
): string {
  const label = windowLabel(type)
  const next = nextOpening
    ? ` The next ${label} window opens on ${nextOpening}.`
    : ''
  return `No registration window is open today for this student.${next}`
}

export type ResolveRegistrationResult =
  | {
      ok: true
      calendar: any
      schoolYear: string
      windowType: RegistrationWindowType
      window: RegistrationWindowInfo
      isOverride: boolean
    }
  | {
      ok: false
      status: 400 | 403
      message: string
    }

/**
 * Resolves the target calendar and applicable registration window.
 * The caller decides whether an override is authorized and stores it.
 */
export async function resolveRegistrationTarget(params: {
  studentId: any
  requestedYear?: string | null
  override: boolean
  excludeEnrollmentId?: any
}): Promise<ResolveRegistrationResult> {
  const timeZone = await getSchoolTimezone()
  const today = todaySchoolDate(timeZone)
  const newStudent = await isNewStudent(
    params.studentId,
    params.excludeEnrollmentId
  )
  const windowType: RegistrationWindowType = newStudent ? 'new-student' : 'general'

  let calendars: any[] = []
  try {
    calendars = await AcademicCalendar.find().lean()
  } catch {
    calendars = []
  }

  if (params.requestedYear) {
    const canonicalYear = normalizeYear(String(params.requestedYear))
    const calendar = calendars.find((entry) =>
      yearsMatch(entry.academicYear, canonicalYear)
    )
    if (!calendar) {
      return {
        ok: false,
        status: 400,
        message: `No academic calendar found for school year "${canonicalYear}"`,
      }
    }

    const endDate = toSchoolDateString(calendar.endDate, timeZone)
    if (endDate && endDate < today) {
      return {
        ok: false,
        status: 400,
        message: `School year "${canonicalYear}" has already ended and cannot be targeted`,
      }
    }

    const window = getRegistrationWindow(calendar, windowType, timeZone, today)
    if (window.isOpen) {
      return {
        ok: true,
        calendar,
        schoolYear: canonicalYear,
        windowType,
        window,
        isOverride: false,
      }
    }

    if (params.override) {
      return {
        ok: true,
        calendar,
        schoolYear: canonicalYear,
        windowType,
        window,
        isOverride: true,
      }
    }

    const nextOpening =
      window.startDate && window.startDate > today
        ? window.startDate
        : await getNextWindowOpening(windowType, timeZone, today)
    return {
      ok: false,
      status: 403,
      message: closedWindowMessage(
        canonicalYear,
        windowType,
        window,
        nextOpening
      ),
    }
  }

  const currentCalendar = await getCurrentCalendar()
  if (currentCalendar) {
    const currentEnd = toSchoolDateString(currentCalendar.endDate, timeZone)
    const currentWindow = getRegistrationWindow(
      currentCalendar,
      windowType,
      timeZone,
      today
    )
    if (currentWindow.isOpen && (!currentEnd || currentEnd >= today)) {
      return {
        ok: true,
        calendar: currentCalendar,
        schoolYear: normalizeYear(String(currentCalendar.academicYear)),
        windowType,
        window: currentWindow,
        isOverride: false,
      }
    }
  }

  const openCalendars = calendars
    .map((calendar) => ({
      calendar,
      window: getRegistrationWindow(calendar, windowType, timeZone, today),
    }))
    .filter((entry) => {
      if (!entry.window.isOpen) return false
      const endDate = toSchoolDateString(entry.calendar.endDate, timeZone)
      return !endDate || endDate >= today
    })
    .sort((a, b) => {
      const aStart = toSchoolDateString(a.calendar.startDate, timeZone) ?? ''
      const bStart = toSchoolDateString(b.calendar.startDate, timeZone) ?? ''
      return bStart.localeCompare(aStart)
    })

  if (openCalendars.length > 0) {
    const chosen = openCalendars[0]
    return {
      ok: true,
      calendar: chosen.calendar,
      schoolYear: normalizeYear(String(chosen.calendar.academicYear)),
      windowType,
      window: chosen.window,
      isOverride: false,
    }
  }

  if (params.override) {
    const current = await getCurrentCalendar()
    if (!current) {
      return {
        ok: false,
        status: 400,
        message: 'No academic calendar is available to override',
      }
    }
    const endDate = toSchoolDateString(current.endDate, timeZone)
    if (endDate && endDate < today) {
      return {
        ok: false,
        status: 400,
        message: `School year "${displayYear(current)}" has already ended and cannot be targeted`,
      }
    }
    return {
      ok: true,
      calendar: current,
      schoolYear: normalizeYear(String(current.academicYear)),
      windowType,
      window: getRegistrationWindow(current, windowType, timeZone, today),
      isOverride: true,
    }
  }

  const nextOpening = await getNextWindowOpening(windowType, timeZone, today)
  return {
    ok: false,
    status: 403,
    message: noOpenWindowMessage(windowType, nextOpening),
  }
}

/** Builds the registration-window read payload for calendars that have not ended. */
export async function getOpenRegistrationCalendarWindows() {
  const snapshot = await getCurrentAcademicSnapshot()
  const { timeZone, today } = snapshot
  const calendars = snapshot.calendars

  const data = calendars
    .filter((calendar) => {
      const endDate = toSchoolDateString(calendar.endDate, timeZone)
      return !endDate || endDate >= today
    })
    .sort((a, b) => {
      const aStart = toSchoolDateString(a.startDate, timeZone) ?? ''
      const bStart = toSchoolDateString(b.startDate, timeZone) ?? ''
      return bStart.localeCompare(aStart)
    })
    .map((calendar) => ({
      ...getRegistrationWindowsForCalendar(calendar, timeZone, today),
      calendar: decorateCalendarRecord(calendar, snapshot),
    }))

  return { today, timeZone, calendars: data }
}

/** Unix/Date comparison helper used to reject past target years. */
export function isPastYear(endDate: string | null, today: string): boolean {
  return !!endDate && isSchoolDateString(endDate) && endDate < today
}
