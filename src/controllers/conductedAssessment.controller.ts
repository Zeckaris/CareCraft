import { Request, Response } from "express";
import mongoose from "mongoose";
import { ConductedAssessment } from '../models/ConductedAssessment.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';
import { AcademicTerm } from '../models/academicTerm.model.js';
import { GradeSubjectAssessment } from '../models/gradeSubjectAssessment.model.js';
import { Section } from '../models/section.model.js';
import { AssessmentSetup } from '../models/assessment/assessmentSetup.model.js';
import { TeachingAssignment } from '../models/teachingAssignment.model.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { getTeacherSectionIds } from '../middlewares/access.middleware.js';

export const getAllConducted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gsaId, academicTermId, sectionId } = req.query;
    const filter: any = {};

    if (gsaId && mongoose.isValidObjectId(gsaId)) filter.gsaId = gsaId;
    if (academicTermId && mongoose.isValidObjectId(academicTermId)) filter.academicTermId = academicTermId;

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
      .sort({ "academicTermId.calendarId": -1, "gsaId.gradeId": 1 });

    sendResponse(res, 200, true, "All conducted assessments fetched", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const getCurrentTermConducted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const currentTerm = await AcademicTerm.findOne({ isCurrent: true });
    if (!currentTerm) {
      sendResponse(res, 404, false, "No current term set");
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
      .populate("conductedStages", "name");

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
      .populate("conductedStages");

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

export const createConducted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { gsaId, academicTermId, sectionId } = req.body;
    if (!gsaId || !academicTermId || !sectionId) {
      sendResponse(res, 400, false, "gsaId, academicTermId, and sectionId are required");
      return;
    }

    if (!mongoose.isValidObjectId(gsaId) || !mongoose.isValidObjectId(academicTermId) || !mongoose.isValidObjectId(sectionId)) {
      sendResponse(res, 400, false, "Invalid ID format in request body");
      return;
    }

    const [gsa, section] = await Promise.all([
      GradeSubjectAssessment.findById(gsaId),
      Section.findById(sectionId),
    ]);

    if (!gsa) {
      sendResponse(res, 404, false, "GradeSubjectAssessment not found");
      return;
    }
    if (!section) {
      sendResponse(res, 404, false, "Section not found");
      return;
    }
    if (section.gradeId.toString() !== gsa.gradeId.toString()) {
      sendResponse(res, 400, false, "Section does not belong to this assessment's grade");
      return;
    }

    const exists = await ConductedAssessment.findOne({ gsaId, academicTermId, sectionId });
    if (exists) {
      sendResponse(res, 400, false, "Already exists for this GSA, Term, and Section");
      return;
    }

    const conducted = await ConductedAssessment.create({
      gsaId,
      academicTermId,
      sectionId,
      conductedStages: [],
      status: "planned",
    });

    sendResponse(res, 201, true, "Conducted assessment created", conducted);
  } catch (error: any) {
    if (error.code === 11000) {
      sendResponse(res, 400, false, "Already exists for this GSA, Term, and Section");
      return;
    }
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const markStageConducted = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { assessmentTypeId } = req.body;
    if (!assessmentTypeId) {
      sendResponse(res, 400, false, "assessmentTypeId required");
      return;
    }

    const conducted = await ConductedAssessment.findById(req.params.id);
    if (!conducted) {
      sendResponse(res, 404, false, "Conducted assessment not found");
      return;
    }

    const gsa = await GradeSubjectAssessment.findById(conducted.gsaId);
    if (!gsa) {
      sendResponse(res, 404, false, "Associated GradeSubjectAssessment not found");
      return;
    }

    const user = req.user;
    if (user?.role === 'teacher') {
      const assignment = await TeachingAssignment.findOne({
        teacherId: user.id,
        sectionId: conducted.sectionId,
        role: 'subject',
        subjectId: gsa.subjectId,
      });
      if (!assignment) {
        sendResponse(res, 403, false, "Forbidden: You are not the assigned subject teacher for this section");
        return;
      }
    }

    const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate('assessmentTypeIds');
    if (!setup) {
      sendResponse(res, 404, false, "Assessment setup not found");
      return;
    }

    const populatedTypes = setup.assessmentTypeIds as any[];
    const typeIndex = populatedTypes.findIndex((t: any) => t._id.equals(assessmentTypeId));
    if (typeIndex === -1) {
      sendResponse(res, 400, false, "Invalid assessment type for this assessment setup");
      return;
    }

    // Stage order enforcement: no skipping stages
    if (typeIndex > conducted.conductedStages.length) {
      const nextExpected = populatedTypes[conducted.conductedStages.length];
      const currentAttempt = populatedTypes[typeIndex];
      sendResponse(
        res,
        400,
        false,
        `Complete "${nextExpected.name}" before "${currentAttempt.name}"`
      );
      return;
    }

    if (!conducted.conductedStages.some((id: any) => id.equals(assessmentTypeId))) {
      conducted.conductedStages.push(assessmentTypeId);
      conducted.status = conducted.conductedStages.length === populatedTypes.length ? "completed" : "in-progress";
      await conducted.save();
    }

    await conducted.populate("conductedStages", "name");
    sendResponse(res, 200, true, "Stage marked as conducted", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};

export const updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.body;
    if (!["planned", "in-progress", "completed"].includes(status)) {
      sendResponse(res, 400, false, "Invalid status");
      return;
    }

    const conducted = await ConductedAssessment.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!conducted) {
      sendResponse(res, 404, false, "Not found");
      return;
    }

    sendResponse(res, 200, true, "Status updated", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};