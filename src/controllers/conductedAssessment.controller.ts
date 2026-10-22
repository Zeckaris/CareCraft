import { Response } from "express";
import mongoose from "mongoose";
import { ConductedAssessment } from '../models/ConductedAssessment.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import { AcademicTerm } from '../models/academicTerm.model.js';
import { AcademicCalendar } from '../models/academicCalendar.model.js';
import { Section } from '../models/section.model.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { getTeacherSectionIds } from '../middlewares/access.middleware.js';
import { getCurrentTerm } from '../service/currentAcademic.service.js';
import { yearsMatch } from '../utils/yearNormalizer.js';

/**
 * Read-only conducted-assessment endpoints.
 *
 * Stage conduct / complete / reopen now live on the assessment-scores router
 * (POST /api/assessment/scores/conduct|complete|reopen) so that all stage and
 * score mutations share one authorization path and one lock model.
 */

export const getAllConducted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gsaId, academicTermId, sectionId } = req.query;
    const filter: any = {};

    if (gsaId) {
      if (!mongoose.isValidObjectId(gsaId)) {
        sendResponse(res, 400, false, 'Invalid gsaId');
        return;
      }
      filter.gsaId = gsaId;
    }

    let requestedSection: any = null;
    if (sectionId) {
      if (!mongoose.isValidObjectId(sectionId)) {
        sendResponse(res, 400, false, 'Invalid sectionId');
        return;
      }
      requestedSection = await Section.findById(sectionId).select('schoolYear').lean();
      if (!requestedSection) {
        sendResponse(res, 404, false, 'Section not found');
        return;
      }
    }

    if (academicTermId) {
      if (!mongoose.isValidObjectId(academicTermId)) {
        sendResponse(res, 400, false, 'Invalid academicTermId');
        return;
      }
      const term = await AcademicTerm.findById(academicTermId).lean();
      if (!term) {
        sendResponse(res, 400, false, 'Academic term not found');
        return;
      }
      const calendar = await AcademicCalendar.findById(term.calendarId).lean();
      if (!calendar) {
        sendResponse(res, 400, false, 'Academic calendar for term not found');
        return;
      }
      if (
        requestedSection &&
        !yearsMatch(calendar.academicYear, requestedSection.schoolYear)
      ) {
        sendResponse(
          res,
          400,
          false,
          `Term "${term.name}" belongs to ${calendar.academicYear}, but this section is for ${requestedSection.schoolYear}`
        );
        return;
      }
      filter.academicTermId = academicTermId;
    }

    const user = req.user;
    if (user?.role === 'teacher') {
      const teacherSectionIds = await getTeacherSectionIds(user.id);
      if (teacherSectionIds.length === 0) {
        sendResponse(res, 200, true, "All conducted assessments fetched", []);
        return;
      }
      if (sectionId) {
        if (!teacherSectionIds.some((sId) => sId.toString() === sectionId.toString())) {
          sendResponse(res, 403, false, "Forbidden: You are not assigned to this section");
          return;
        }
        filter.sectionId = sectionId;
      } else {
        filter.sectionId = { $in: teacherSectionIds };
      }
    } else if (sectionId && mongoose.isValidObjectId(sectionId)) {
      filter.sectionId = sectionId;
    }

    const conducted = await ConductedAssessment.find(filter)
      .populate("gsaId", "gradeId subjectId")
      .populate("academicTermId", "name calendarId")
      .populate("sectionId", "name gradeId schoolYear")
      .populate("conductedStages", "name weight")
      .populate("lockedStages", "name weight")
      .sort({ "academicTermId.calendarId": -1, "gsaId.gradeId": 1 });

    sendResponse(res, 200, true, "All conducted assessments fetched", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const getCurrentTermConducted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentTerm = await getCurrentTerm();
    if (!currentTerm) {
      sendResponse(
        res,
        404,
        false,
        "No current academic term is available based on calendar dates"
      );
      return;
    }

    const { sectionId } = req.query;
    const filter: any = { academicTermId: currentTerm._id };

    const user = req.user;
    if (user?.role === 'teacher') {
      const teacherSectionIds = await getTeacherSectionIds(user.id);
      if (teacherSectionIds.length === 0) {
        sendResponse(res, 200, true, "Current term conducted assessments", []);
        return;
      }
      if (sectionId) {
        if (!teacherSectionIds.some((sId) => sId.toString() === sectionId.toString())) {
          sendResponse(res, 403, false, "Forbidden: You are not assigned to this section");
          return;
        }
        filter.sectionId = sectionId;
      } else {
        filter.sectionId = { $in: teacherSectionIds };
      }
    } else if (sectionId && mongoose.isValidObjectId(sectionId)) {
      filter.sectionId = sectionId;
    }

    const conducted = await ConductedAssessment.find(filter)
      .populate("gsaId", "gradeId subjectId")
      .populate("sectionId", "name gradeId schoolYear")
      .populate("conductedStages", "name")
      .populate("lockedStages", "name");

    sendResponse(res, 200, true, "Current term conducted assessments", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const getConductedById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const conducted = await ConductedAssessment.findById(req.params.id)
      .populate("gsaId")
      .populate("academicTermId")
      .populate("sectionId", "name gradeId schoolYear")
      .populate("conductedStages")
      .populate("lockedStages");

    if (!conducted) {
      sendResponse(res, 404, false, "Conducted assessment not found");
      return;
    }

    const user = req.user;
    if (user?.role === 'teacher') {
      const teacherSectionIds = await getTeacherSectionIds(user.id);
      const secId = (conducted.sectionId as any)?._id || conducted.sectionId;
      if (!teacherSectionIds.some((sId) => sId.toString() === secId.toString())) {
        sendResponse(res, 403, false, "Forbidden: You are not assigned to this section");
        return;
      }
    }

    sendResponse(res, 200, true, "Conducted assessment found", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};
