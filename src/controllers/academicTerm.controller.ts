import { Request, Response } from "express";
import mongoose from "mongoose";
import { AcademicTerm } from '../models/academicTerm.model.js';
import { AcademicCalendar } from '../models/academicCalendar.model.js';
import { AssessmentScore } from '../models/assessment/assessmentScore.model.js';
import { ConductedAssessment } from '../models/ConductedAssessment.model.js';
import { Attendance } from '../models/attendance.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import {
  getSchoolTimezone,
  normalizeSchoolDateInput,
  toSchoolDateString,
} from '../utils/schoolDate.util.js';
import {
  decorateTermRecord,
  getCurrentAcademicSnapshot,
} from '../service/currentAcademic.service.js';

const TERM_FIELDS = ['calendarId', 'name', 'sequence', 'startDate', 'endDate'] as const;

const hasOwn = (obj: any, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj ?? {}, key);

function normalizeSequence(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseRequiredDate(value: unknown, timeZone: string): Date | null {
  return normalizeSchoolDateInput(value, timeZone);
}

async function countTermReferences(termId: any) {
  const [assessmentScores, conductedAssessments, attendanceRecords] =
    await Promise.all([
      AssessmentScore.countDocuments({ academicTermId: termId }),
      ConductedAssessment.countDocuments({ academicTermId: termId }),
      Attendance.countDocuments({ academicTermId: termId }),
    ]);
  return { assessmentScores, conductedAssessments, attendanceRecords };
}

async function findOverlappingTerm(
  calendarId: any,
  startDate: string,
  endDate: string,
  timeZone: string,
  excludeId?: string
): Promise<any | null> {
  const terms = await AcademicTerm.find(
    excludeId ? { calendarId, _id: { $ne: excludeId } } : { calendarId }
  ).lean();
  for (const term of terms) {
    const termStart = toSchoolDateString(term.startDate, timeZone);
    const termEnd = toSchoolDateString(term.endDate, timeZone);
    if (!termStart || !termEnd) continue;
    if (startDate <= termEnd && termStart <= endDate) return term;
  }
  return null;
}

async function findDuplicateTerm(
  calendarId: any,
  sequence: number,
  name: string,
  excludeId?: string
): Promise<{ sequence?: any; name?: any }> {
  const base: any = { calendarId };
  if (excludeId) base._id = { $ne: excludeId };

  const [sequenceDuplicate, nameDuplicate] = await Promise.all([
    AcademicTerm.findOne({ ...base, sequence }).lean(),
    AcademicTerm.findOne({ ...base, name })
      .collation({ locale: 'en', strength: 2 })
      .lean(),
  ]);
  return {
    sequence: sequenceDuplicate ?? undefined,
    name: nameDuplicate ?? undefined,
  };
}

function handleTermError(res: Response, error: any) {
  if (error?.code === 11000) {
    const field = Object.keys(error?.keyPattern ?? {})[0];
    sendResponse(
      res,
      400,
      false,
      field === 'sequence'
        ? 'sequence must be unique within the calendar'
        : 'name must be unique within the calendar'
    );
    return;
  }
  if (error?.name === 'ValidationError') {
    sendResponse(res, 400, false, error.message);
    return;
  }
  sendResponse(res, 500, false, "Server error", null, error);
}

export const getAllTerms = async (req: Request, res: Response) => {
  try {
    const snapshot = await getCurrentAcademicSnapshot();
    const terms = await AcademicTerm.find()
      .populate("calendarId", "academicYear")
      .sort({ "calendarId.academicYear": -1, sequence: 1 })
      .lean();
    sendResponse(
      res,
      200,
      true,
      "All terms fetched",
      terms.map((term) => decorateTermRecord(term, snapshot))
    );
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const getCurrentTerm = async (req: Request, res: Response) => {
  try {
    const snapshot = await getCurrentAcademicSnapshot();
    if (!snapshot.currentTerm) {
      return sendResponse(res, 200, true, "Current term", null);
    }
    const term = await AcademicTerm.findById(snapshot.currentTerm._id)
      .populate("calendarId", "academicYear startDate endDate")
      .lean();
    sendResponse(
      res,
      200,
      true,
      "Current term",
      term ? decorateTermRecord(term, snapshot) : null
    );
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const getTermsByCalendar = async (req: Request, res: Response) => {
  try {
    const { calendarId } = req.params;
    if (!mongoose.isValidObjectId(calendarId)) {
      return sendResponse(res, 400, false, "Invalid calendar ID");
    }
    const calendar = await AcademicCalendar.findById(calendarId).select('_id').lean();
    if (!calendar) {
      return sendResponse(res, 404, false, "Calendar not found");
    }
    const snapshot = await getCurrentAcademicSnapshot();
    const terms = await AcademicTerm.find({ calendarId })
      .sort({ sequence: 1 })
      .lean();
    sendResponse(
      res,
      200,
      true,
      "Terms for calendar",
      terms.map((term) => decorateTermRecord(term, snapshot))
    );
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const getTermById = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendResponse(res, 400, false, "Invalid term ID");
    }
    const snapshot = await getCurrentAcademicSnapshot();
    const term = await AcademicTerm.findById(req.params.id)
      .populate("calendarId", "academicYear")
      .lean();
    if (!term) return sendResponse(res, 404, false, "Term not found");
    sendResponse(res, 200, true, "Term found", decorateTermRecord(term, snapshot));
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const createTerm = async (req: Request, res: Response) => {
  try {
    const body = req.body ?? {};
    const { calendarId, name, sequence, startDate, endDate } = body;
    if (
      !calendarId ||
      name === undefined ||
      sequence === undefined ||
      startDate === undefined ||
      endDate === undefined
    ) {
      return sendResponse(res, 400, false, "Missing required fields");
    }
    if (!mongoose.isValidObjectId(calendarId)) {
      return sendResponse(res, 400, false, "Invalid calendarId");
    }

    const calendar = await AcademicCalendar.findById(calendarId).lean();
    if (!calendar) {
      return sendResponse(res, 404, false, "Calendar not found");
    }

    const normalizedName = normalizeName(name);
    if (!normalizedName) {
      return sendResponse(res, 400, false, "name is required");
    }
    const normalizedSequence = normalizeSequence(sequence);
    if (normalizedSequence === null) {
      return sendResponse(res, 400, false, "sequence must be a positive integer");
    }

    const timeZone = await getSchoolTimezone();
    const normalizedStart = parseRequiredDate(startDate, timeZone);
    const normalizedEnd = parseRequiredDate(endDate, timeZone);
    if (!normalizedStart || !normalizedEnd) {
      return sendResponse(res, 400, false, "Invalid startDate or endDate");
    }

    const start = toSchoolDateString(normalizedStart, timeZone)!;
    const end = toSchoolDateString(normalizedEnd, timeZone)!;
    if (start >= end) {
      return sendResponse(res, 400, false, "startDate must be before endDate");
    }

    const calendarStart = toSchoolDateString(calendar.startDate, timeZone);
    const calendarEnd = toSchoolDateString(calendar.endDate, timeZone);
    if (!calendarStart || !calendarEnd) {
      return sendResponse(res, 400, false, "Calendar has invalid start or end dates");
    }
    if (start < calendarStart || end > calendarEnd) {
      return sendResponse(
        res,
        400,
        false,
        `Term dates must be inside the calendar (${calendarStart} – ${calendarEnd})`
      );
    }

    const overlap = await findOverlappingTerm(calendar._id, start, end, timeZone);
    if (overlap) {
      return sendResponse(
        res,
        400,
        false,
        `Term dates overlap with existing term "${overlap.name}"`
      );
    }

    const duplicates = await findDuplicateTerm(
      calendar._id,
      normalizedSequence,
      normalizedName
    );
    if (duplicates.sequence) {
      return sendResponse(
        res,
        400,
        false,
        `sequence ${normalizedSequence} is already used in this calendar`
      );
    }
    if (duplicates.name) {
      return sendResponse(
        res,
        400,
        false,
        `Term name "${normalizedName}" is already used in this calendar`
      );
    }

    const term = await AcademicTerm.create({
      calendarId: calendar._id,
      name: normalizedName,
      sequence: normalizedSequence,
      startDate: normalizedStart,
      endDate: normalizedEnd,
    });

    const snapshot = await getCurrentAcademicSnapshot();
    sendResponse(
      res,
      201,
      true,
      "Term created",
      decorateTermRecord(term, snapshot)
    );
  } catch (error) {
    handleTermError(res, error);
  }
};

export const updateTerm = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendResponse(res, 400, false, "Invalid term ID");
    }
    const term = await AcademicTerm.findById(req.params.id);
    if (!term) return sendResponse(res, 404, false, "Term not found");

    const body = req.body ?? {};
    const timeZone = await getSchoolTimezone();

    let targetCalendarId = term.calendarId;
    if (hasOwn(body, 'calendarId')) {
      if (!mongoose.isValidObjectId(body.calendarId)) {
        return sendResponse(res, 400, false, "Invalid calendarId");
      }
      targetCalendarId = new mongoose.Types.ObjectId(body.calendarId);
    }

    const calendar = await AcademicCalendar.findById(targetCalendarId).lean();
    if (!calendar) {
      return sendResponse(res, 404, false, "Calendar not found");
    }

    const relinking = String(targetCalendarId) !== String(term.calendarId);
    if (relinking) {
      const refs = await countTermReferences(term._id);
      const blockers: string[] = [];
      if (refs.assessmentScores > 0) {
        blockers.push(`${refs.assessmentScores} assessment score(s)`);
      }
      if (refs.conductedAssessments > 0) {
        blockers.push(`${refs.conductedAssessments} conducted assessment(s)`);
      }
      if (refs.attendanceRecords > 0) {
        blockers.push(`${refs.attendanceRecords} attendance record(s)`);
      }
      if (blockers.length > 0) {
        return sendResponse(
          res,
          400,
          false,
          `Cannot move term to another calendar: still referenced by ${blockers.join(', ')}.`
        );
      }
    }

    const name = hasOwn(body, 'name') ? normalizeName(body.name) : term.name;
    if (!name) {
      return sendResponse(res, 400, false, "name is required");
    }

    const sequence = hasOwn(body, 'sequence')
      ? normalizeSequence(body.sequence)
      : term.sequence;
    if (sequence === null) {
      return sendResponse(res, 400, false, "sequence must be a positive integer");
    }

    let startDate = term.startDate;
    let endDate = term.endDate;
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

    const start = toSchoolDateString(startDate, timeZone);
    const end = toSchoolDateString(endDate, timeZone);
    if (!start || !end) {
      return sendResponse(res, 400, false, "startDate and endDate are required");
    }
    if (start >= end) {
      return sendResponse(res, 400, false, "startDate must be before endDate");
    }

    const calendarStart = toSchoolDateString(calendar.startDate, timeZone);
    const calendarEnd = toSchoolDateString(calendar.endDate, timeZone);
    if (!calendarStart || !calendarEnd) {
      return sendResponse(res, 400, false, "Calendar has invalid start or end dates");
    }
    if (start < calendarStart || end > calendarEnd) {
      return sendResponse(
        res,
        400,
        false,
        `Term dates must be inside the calendar (${calendarStart} – ${calendarEnd})`
      );
    }

    const overlap = await findOverlappingTerm(
      targetCalendarId,
      start,
      end,
      timeZone,
      String(term._id)
    );
    if (overlap) {
      return sendResponse(
        res,
        400,
        false,
        `Term dates overlap with existing term "${overlap.name}"`
      );
    }

    const duplicates = await findDuplicateTerm(
      targetCalendarId,
      sequence,
      name,
      String(term._id)
    );
    if (duplicates.sequence) {
      return sendResponse(
        res,
        400,
        false,
        `sequence ${sequence} is already used in this calendar`
      );
    }
    if (duplicates.name) {
      return sendResponse(
        res,
        400,
        false,
        `Term name "${name}" is already used in this calendar`
      );
    }

    term.calendarId = targetCalendarId;
    term.name = name;
    term.sequence = sequence;
    term.startDate = startDate;
    term.endDate = endDate;
    await term.save();

    const snapshot = await getCurrentAcademicSnapshot();
    sendResponse(
      res,
      200,
      true,
      "Term updated",
      decorateTermRecord(term, snapshot)
    );
  } catch (error) {
    handleTermError(res, error);
  }
};

export const setCurrentTerm = async (req: Request, res: Response) => {
  return sendResponse(
    res,
    410,
    false,
    'Current term is now determined by dates and cannot be set manually.'
  );
};

export const deleteTerm = async (req: Request, res: Response) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return sendResponse(res, 400, false, "Invalid term ID");
    }
    const term = await AcademicTerm.findById(req.params.id);
    if (!term) return sendResponse(res, 404, false, "Term not found");

    const refs = await countTermReferences(term._id);
    const blockers: string[] = [];
    if (refs.assessmentScores > 0) {
      blockers.push(`${refs.assessmentScores} assessment score(s)`);
    }
    if (refs.conductedAssessments > 0) {
      blockers.push(`${refs.conductedAssessments} conducted assessment(s)`);
    }
    if (refs.attendanceRecords > 0) {
      blockers.push(`${refs.attendanceRecords} attendance record(s)`);
    }

    if (blockers.length > 0) {
      return sendResponse(
        res,
        400,
        false,
        `Cannot delete term "${term.name}". It is still referenced by ${blockers.join(', ')}. Remove those records first.`
      );
    }

    await AcademicTerm.deleteOne({ _id: term._id });
    sendResponse(res, 200, true, "Term deleted");
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};
