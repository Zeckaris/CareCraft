import { Request, Response } from "express";
import mongoose from "mongoose";
import { AcademicCalendar } from '../models/academicCalendar.model.js';
import { AcademicTerm } from '../models/academicTerm.model.js';
import { Section } from '../models/section.model.js';
import { StudentEnrollment } from '../models/studentEnrollment.model.js';
import { Schedule } from '../models/schedule.model.js';
import { guardDeleteReferences, type ReferenceCheck } from '../utils/referenceGuard.util.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js';
import {
  getSchoolTimezone,
  normalizeSchoolDateInput,
  toSchoolDateString,
} from '../utils/schoolDate.util.js';
import {
  decorateCalendarRecord,
  decorateTermRecord,
  getCurrentAcademicSnapshot,
} from '../service/currentAcademic.service.js';

const CALENDAR_FIELDS = [
  'academicYear',
  'startDate',
  'endDate',
  'registrationStartDate',
  'registrationEndDate',
  'newStudentRegistrationStartDate',
  'newStudentRegistrationEndDate',
  'holidayDates',
] as const;

const hasOwn = (obj: any, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj ?? {}, key);

function canonicalYear(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = normalizeYear(trimmed);
  return /^\d{4}-\d{4}$/.test(normalized) ? normalized : null;
}

function parseRequiredDate(value: unknown, timeZone: string): Date | null {
  return normalizeSchoolDateInput(value, timeZone);
}

function parseOptionalDate(value: unknown, timeZone: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return normalizeSchoolDateInput(value, timeZone) ?? undefined;
}

function dateString(value: Date | null | undefined, timeZone: string): string | null {
  return toSchoolDateString(value, timeZone);
}

function validateRegistrationWindow(
  start: Date | null | undefined,
  end: Date | null | undefined,
  calendarEnd: string | null,
  label: string,
  timeZone: string
): string | null {
  const startDate = toSchoolDateString(start ?? null, timeZone);
  const endDate = toSchoolDateString(end ?? null, timeZone);
  if (!startDate && !endDate) return null;
  if (!startDate || !endDate) {
    return `${label} must have both a start date and an end date`;
  }
  if (startDate > endDate) {
    return `${label} start date must be on or before its end date`;
  }
  if (calendarEnd && endDate > calendarEnd) {
    return `${label} must end on or before the calendar end date (${calendarEnd})`;
  }
  return null;
}

function parseHolidayDates(value: unknown, timeZone: string): Date[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const dates: Date[] = [];
  for (const entry of value) {
    const parsed = normalizeSchoolDateInput(entry, timeZone);
    if (!parsed) return null;
    const key = dateString(parsed, timeZone)!;
    if (seen.has(key)) return null;
    seen.add(key);
    dates.push(parsed);
  }
  return dates;
}

async function findOverlappingCalendar(
  startDate: string,
  endDate: string,
  academicYear: string,
  timeZone: string,
  excludeId?: string
): Promise<any | null> {
  const calendars = await AcademicCalendar.find(
    excludeId ? { _id: { $ne: excludeId } } : {}
  ).lean();
  for (const calendar of calendars) {
    if (normalizeYear(String(calendar.academicYear)) === academicYear) continue;
    const otherStart = toSchoolDateString(calendar.startDate, timeZone);
    const otherEnd = toSchoolDateString(calendar.endDate, timeZone);
    if (!otherStart || !otherEnd) continue;
    if (startDate <= otherEnd && otherStart <= endDate) return calendar;
  }
  return null;
}

async function countYearReferences(academicYear: string) {
  const variants = getYearVariants(academicYear);
  const [sections, enrollments, schedules] = await Promise.all([
    Section.countDocuments({ schoolYear: { $in: variants } }),
    StudentEnrollment.countDocuments({ schoolYear: { $in: variants } }),
    Schedule.countDocuments({ schoolYear: { $in: variants } }),
  ]);
  return { sections, enrollments, schedules };
}

async function validateExistingTermsInside(
  calendarId: any,
  startDate: string,
  endDate: string,
  timeZone: string
): Promise<string | null> {
  const terms = await AcademicTerm.find({ calendarId }).lean();
  if (terms.length === 0) return null;
  for (const term of terms) {
    const termStart = toSchoolDateString(term.startDate, timeZone);
    const termEnd = toSchoolDateString(term.endDate, timeZone);
    if (!termStart || !termEnd) {
      return `Existing term "${term.name}" has missing or invalid dates and cannot be validated against the new calendar dates`;
    }
    if (termStart < startDate || termEnd > endDate) {
      return `Existing term "${term.name}" (${termStart} – ${termEnd}) would fall outside the new calendar dates`;
    }
  }
  return null;
}

function handleCalendarError(res: Response, error: any) {
  if (error?.code === 11000) {
    sendResponse(res, 409, false, 'Academic year already exists');
    return;
  }
  if (error?.name === 'ValidationError') {
    sendResponse(res, 400, false, error.message);
    return;
  }
  sendResponse(res, 500, false, "Server error", null, error);
}

export const getAllCalendars = async (req: Request, res: Response) => {
  try {
    const snapshot = await getCurrentAcademicSnapshot();
    const calendars = await AcademicCalendar.find().sort({ academicYear: -1 }).lean();
    sendResponse(
      res,
      200,
      true,
      "Academic calendars fetched",
      calendars.map((calendar) => decorateCalendarRecord(calendar, snapshot))
    );
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null,  error);
  }
};

export const getCurrentCalendar = async (req: Request, res: Response) => {
  try {
    const snapshot = await getCurrentAcademicSnapshot();
    sendResponse(
      res,
      200,
      true,
      "Current calendar",
      snapshot.currentCalendar
        ? decorateCalendarRecord(snapshot.currentCalendar, snapshot)
        : null
    );
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

/** GET /api/calendar/current-context — current calendar, term and phase. */
export const getCurrentAcademicContext = async (req: Request, res: Response) => {
  try {
    const snapshot = await getCurrentAcademicSnapshot();
    sendResponse(res, 200, true, 'Current academic context fetched', {
      today: snapshot.today,
      phase: snapshot.phase,
      currentCalendar: snapshot.currentCalendar
        ? decorateCalendarRecord(snapshot.currentCalendar, snapshot)
        : null,
      currentTerm: snapshot.currentTerm
        ? decorateTermRecord(snapshot.currentTerm, snapshot)
        : null,
    });
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const getCalendarById = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendResponse(res, 400, false, "Invalid calendar ID");
    }
    const snapshot = await getCurrentAcademicSnapshot();
    const calendar = await AcademicCalendar.findById(req.params.id).lean();
    if (!calendar) return sendResponse(res, 404, false, "Calendar not found");
    sendResponse(
      res,
      200,
      true,
      "Calendar found",
      decorateCalendarRecord(calendar, snapshot)
    );
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const createCalendar = async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const { academicYear, startDate, endDate } = body;

    if (!academicYear || startDate === undefined || endDate === undefined) {
      return sendResponse(res, 400, false, "Missing required fields");
    }

    const year = canonicalYear(academicYear);
    if (!year) {
      return sendResponse(res, 400, false, "academicYear must be in YYYY-YYYY format");
    }

    const timeZone = await getSchoolTimezone();
    const normalizedStart = parseRequiredDate(startDate, timeZone);
    const normalizedEnd = parseRequiredDate(endDate, timeZone);
    if (!normalizedStart || !normalizedEnd) {
      return sendResponse(res, 400, false, "Invalid startDate or endDate");
    }

    const start = dateString(normalizedStart, timeZone)!;
    const end = dateString(normalizedEnd, timeZone)!;
    if (start >= end) {
      return sendResponse(res, 400, false, "startDate must be before endDate");
    }

    const startYear = Number(start.slice(0, 4));
    const endYear = Number(end.slice(0, 4));
    const labelStartYear = Number(year.slice(0, 4));
    const labelEndYear = Number(year.slice(5));
    if (startYear !== labelStartYear) {
      return sendResponse(
        res,
        400,
        false,
        `startDate year (${startYear}) must equal the first year in academicYear (${labelStartYear})`
      );
    }
    if (endYear !== labelStartYear && endYear !== labelEndYear) {
      return sendResponse(
        res,
        400,
        false,
        `endDate year (${endYear}) must match one of the academicYear years (${labelStartYear}, ${labelEndYear})`
      );
    }

    const duplicate = await AcademicCalendar.findOne({
      academicYear: { $in: getYearVariants(year) },
    }).lean();
    if (duplicate) {
      return sendResponse(res, 409, false, "Academic year already exists");
    }

    const overlap = await findOverlappingCalendar(start, end, year, timeZone);
    if (overlap) {
      return sendResponse(
        res,
        400,
        false,
        `Calendar dates overlap with academic year ${overlap.academicYear}`
      );
    }

    const regStart = parseOptionalDate(body.registrationStartDate, timeZone);
    const regEnd = parseOptionalDate(body.registrationEndDate, timeZone);
    const newRegStart = parseOptionalDate(body.newStudentRegistrationStartDate, timeZone);
    const newRegEnd = parseOptionalDate(body.newStudentRegistrationEndDate, timeZone);
    if (
      (body.registrationStartDate !== undefined && regStart === undefined) ||
      (body.registrationEndDate !== undefined && regEnd === undefined) ||
      (body.newStudentRegistrationStartDate !== undefined && newRegStart === undefined) ||
      (body.newStudentRegistrationEndDate !== undefined && newRegEnd === undefined)
    ) {
      return sendResponse(res, 400, false, "Invalid registration date");
    }

    const generalError = validateRegistrationWindow(
      regStart,
      regEnd,
      end,
      'General registration',
      timeZone
    );
    if (generalError) return sendResponse(res, 400, false, generalError);
    const newStudentError = validateRegistrationWindow(
      newRegStart,
      newRegEnd,
      end,
      'New-student registration',
      timeZone
    );
    if (newStudentError) return sendResponse(res, 400, false, newStudentError);

    const holidays = parseHolidayDates(body.holidayDates, timeZone);
    if (!holidays) {
      return sendResponse(
        res,
        400,
        false,
        "holidayDates must be an array of unique valid dates"
      );
    }
    for (const holiday of holidays) {
      const holidayString = dateString(holiday, timeZone)!;
      if (holidayString < start || holidayString > end) {
        return sendResponse(
          res,
          400,
          false,
          `Holiday ${holidayString} is outside the academic year (${start} – ${end})`
        );
      }
    }

    const calendar = await AcademicCalendar.create({
      academicYear: year,
      startDate: normalizedStart,
      endDate: normalizedEnd,
      registrationStartDate: regStart ?? null,
      registrationEndDate: regEnd ?? null,
      newStudentRegistrationStartDate: newRegStart ?? null,
      newStudentRegistrationEndDate: newRegEnd ?? null,
      holidayDates: holidays,
    });

    const snapshot = await getCurrentAcademicSnapshot();
    sendResponse(
      res,
      201,
      true,
      "Academic calendar created",
      decorateCalendarRecord(calendar, snapshot)
    );
  } catch (error) {
    handleCalendarError(res, error);
  }
};

export const updateCalendar = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendResponse(res, 400, false, "Invalid calendar ID");
    }

    const calendar = await AcademicCalendar.findById(req.params.id);
    if (!calendar) return sendResponse(res, 404, false, "Calendar not found");

    const body = req.body ?? {};
    const timeZone = await getSchoolTimezone();

    const currentYear = normalizeYear(String(calendar.academicYear));
    let targetYear = currentYear;

    if (hasOwn(body, 'academicYear')) {
      const parsedYear = canonicalYear(body.academicYear);
      if (!parsedYear) {
        return sendResponse(res, 400, false, "academicYear must be in YYYY-YYYY format");
      }
      targetYear = parsedYear;
    }

    if (targetYear !== currentYear) {
      const [termCount, refs] = await Promise.all([
        AcademicTerm.countDocuments({ calendarId: calendar._id }),
        countYearReferences(currentYear),
      ]);
      const blockers: string[] = [];
      if (termCount > 0) blockers.push(`${termCount} term(s)`);
      if (refs.sections > 0) blockers.push(`${refs.sections} section(s)`);
      if (refs.enrollments > 0) blockers.push(`${refs.enrollments} enrollment(s)`);
      if (refs.schedules > 0) blockers.push(`${refs.schedules} schedule(s)`);
      if (blockers.length > 0) {
        return sendResponse(
          res,
          400,
          false,
          `Cannot change academic year: still referenced by ${blockers.join(', ')}. Remove those records first.`
        );
      }

      const duplicate = await AcademicCalendar.findOne({
        _id: { $ne: calendar._id },
        academicYear: { $in: getYearVariants(targetYear) },
      }).lean();
      if (duplicate) {
        return sendResponse(res, 409, false, "Academic year already exists");
      }
    }

    let startDate = calendar.startDate;
    let endDate = calendar.endDate;
    if (hasOwn(body, 'startDate')) {
      const parsed = parseRequiredDate(body.startDate, timeZone);
      if (!parsed) return sendResponse(res, 400, false, "Invalid startDate");
      startDate = parsed;
    }
    if (hasOwn(body, 'endDate')) {
      const parsed = parseRequiredDate(body.endDate, timeZone);
      if (!parsed) return sendResponse(res, 400, false, "Invalid endDate");
      endDate = parsed;
    }

    const start = dateString(startDate, timeZone);
    const end = dateString(endDate, timeZone);
    if (!start || !end) {
      return sendResponse(res, 400, false, "startDate and endDate are required");
    }
    if (start >= end) {
      return sendResponse(res, 400, false, "startDate must be before endDate");
    }

    const startYear = Number(start.slice(0, 4));
    const endYear = Number(end.slice(0, 4));
    const labelStartYear = Number(targetYear.slice(0, 4));
    const labelEndYear = Number(targetYear.slice(5));
    if (startYear !== labelStartYear) {
      return sendResponse(
        res,
        400,
        false,
        `startDate year (${startYear}) must equal the first year in academicYear (${labelStartYear})`
      );
    }
    if (endYear !== labelStartYear && endYear !== labelEndYear) {
      return sendResponse(
        res,
        400,
        false,
        `endDate year (${endYear}) must match one of the academicYear years (${labelStartYear}, ${labelEndYear})`
      );
    }

    const overlap = await findOverlappingCalendar(
      start,
      end,
      targetYear,
      timeZone,
      String(calendar._id)
    );
    if (overlap) {
      return sendResponse(
        res,
        400,
        false,
        `Calendar dates overlap with academic year ${overlap.academicYear}`
      );
    }

    const termsError = await validateExistingTermsInside(calendar._id, start, end, timeZone);
    if (termsError) return sendResponse(res, 400, false, termsError);

    const registrationFields = [
      'registrationStartDate',
      'registrationEndDate',
      'newStudentRegistrationStartDate',
      'newStudentRegistrationEndDate',
    ] as const;
    const parsedRegistration: Record<string, Date | null | undefined> = {};
    for (const field of registrationFields) {
      if (!hasOwn(body, field)) {
        parsedRegistration[field] = calendar[field] ?? null;
        continue;
      }
      const parsed = parseOptionalDate(body[field], timeZone);
      if (parsed === undefined) {
        return sendResponse(res, 400, false, `Invalid ${field}`);
      }
      parsedRegistration[field] = parsed;
    }

    const generalError = validateRegistrationWindow(
      parsedRegistration.registrationStartDate,
      parsedRegistration.registrationEndDate,
      end,
      'General registration',
      timeZone
    );
    if (generalError) return sendResponse(res, 400, false, generalError);
    const newStudentError = validateRegistrationWindow(
      parsedRegistration.newStudentRegistrationStartDate,
      parsedRegistration.newStudentRegistrationEndDate,
      end,
      'New-student registration',
      timeZone
    );
    if (newStudentError) return sendResponse(res, 400, false, newStudentError);

    let holidays = calendar.holidayDates ?? [];
    if (hasOwn(body, 'holidayDates')) {
      const parsedHolidays = parseHolidayDates(body.holidayDates, timeZone);
      if (!parsedHolidays) {
        return sendResponse(
          res,
          400,
          false,
          "holidayDates must be an array of unique valid dates"
        );
      }
      holidays = parsedHolidays;
    }
    for (const holiday of holidays) {
      const holidayString = toSchoolDateString(holiday, timeZone);
      if (!holidayString) {
        return sendResponse(res, 400, false, "Invalid holiday date");
      }
      if (holidayString < start || holidayString > end) {
        return sendResponse(
          res,
          400,
          false,
          `Holiday ${holidayString} is outside the academic year (${start} – ${end})`
        );
      }
    }

    calendar.academicYear = targetYear;
    calendar.startDate = startDate;
    calendar.endDate = endDate;
    calendar.registrationStartDate = parsedRegistration.registrationStartDate as any;
    calendar.registrationEndDate = parsedRegistration.registrationEndDate as any;
    calendar.newStudentRegistrationStartDate =
      parsedRegistration.newStudentRegistrationStartDate as any;
    calendar.newStudentRegistrationEndDate =
      parsedRegistration.newStudentRegistrationEndDate as any;
    calendar.holidayDates = holidays;

    await calendar.save();

    const snapshot = await getCurrentAcademicSnapshot();
    sendResponse(
      res,
      200,
      true,
      "Calendar updated",
      decorateCalendarRecord(calendar, snapshot)
    );
  } catch (error) {
    handleCalendarError(res, error);
  }
};

export const setCurrentCalendar = async (req: Request, res: Response) => {
  return sendResponse(
    res,
    410,
    false,
    'Current calendar is now determined by dates and cannot be set manually.'
  );
};

export const deleteCalendar = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendResponse(res, 400, false, "Invalid calendar ID");
    }

    const calendar = await AcademicCalendar.findById(req.params.id);
    if (!calendar) return sendResponse(res, 404, false, "Calendar not found");

    const snapshot = await getCurrentAcademicSnapshot();
    if (
      snapshot.currentCalendar &&
      String(snapshot.currentCalendar._id) === String(calendar._id)
    ) {
      return sendResponse(
        res,
        400,
        false,
        "Cannot delete the current calendar. Update its dates or create another calendar that covers today first."
      );
    }

    const year = normalizeYear(String(calendar.academicYear));
    const variants = getYearVariants(year);
    const referenceChecks: ReferenceCheck[] = [
      { model: AcademicTerm, field: 'calendarId', label: 'term(s)' },
      {
        model: Section,
        filter: { schoolYear: { $in: variants } },
        label: 'section(s)',
      },
      {
        model: StudentEnrollment,
        filter: { schoolYear: { $in: variants } },
        label: 'enrollment(s)',
      },
      {
        model: Schedule,
        filter: { schoolYear: { $in: variants } },
        label: 'schedule(s)',
      },
    ];

    if (
      await guardDeleteReferences(
        res,
        `calendar "${calendar.academicYear}"`,
        calendar._id,
        referenceChecks
      )
    ) {
      return;
    }

    await AcademicCalendar.deleteOne({ _id: calendar._id });
    sendResponse(res, 200, true, "Calendar deleted");
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};
