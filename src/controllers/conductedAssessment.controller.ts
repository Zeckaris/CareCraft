import { Request, Response } from "express";
import { ConductedAssessment } from "../models/ConductedAssessment.model";
import { sendResponse } from "../utils/sendResponse.util";
import { AcademicTerm } from "../models/academicTerm.model";



export const getAllConducted = async (req: Request, res: Response) => {
  try {
    const conducted = await ConductedAssessment.find()
      .populate("gsaId", "gradeId subjectId")
      .populate("academicTermId", "name calendarId")
      .populate("conductedStages", "name weight")
      .sort({ "academicTermId.calendarId": -1, "gsaId.gradeId": 1 });
    sendResponse(res, 200, true, "All conducted assessments fetched", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const getCurrentTermConducted = async (req: Request, res: Response) => {
  try {
    const currentTerm = await AcademicTerm.findOne({ isCurrent: true });
    if (!currentTerm) return sendResponse(res, 404, false, "No current term set");

    const conducted = await ConductedAssessment.find({ academicTermId: currentTerm._id })
      .populate("gsaId", "gradeId subjectId")
      .populate("conductedStages", "name");

    sendResponse(res, 200, true, "Current term conducted assessments", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};



export const getConductedById = async (req: Request, res: Response) => {
  try {
    const conducted = await ConductedAssessment.findById(req.params.id)
      .populate("gsaId")
      .populate("academicTermId")
      .populate("conductedStages");
    if (!conducted) return sendResponse(res, 404, false, "Conducted assessment not found");
    sendResponse(res, 200, true, "Conducted assessment found", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const createConducted = async (req: Request, res: Response) => {
  try {
    const { gsaId, academicTermId } = req.body;
    if (!gsaId || !academicTermId)
      return sendResponse(res, 400, false, "gsaId and academicTermId required");

    const exists = await ConductedAssessment.findOne({ gsaId, academicTermId });
    if (exists) return sendResponse(res, 400, false, "Already exists for this GSA + Term");

    const conducted = await ConductedAssessment.create({
      gsaId,
      academicTermId,
      conductedStages: [],
      status: "planned",
    });
    sendResponse(res, 201, true, "Conducted assessment created", conducted);
  } catch (error: any) {
    if (error.code === 11000)
      return sendResponse(res, 400, false, "Already exists for this GSA + Term");
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const markStageConducted = async (req: Request, res: Response) => {
  try {
    const { assessmentTypeId } = req.body;
    if (!assessmentTypeId)
      return sendResponse(res, 400, false, "assessmentTypeId required");

    const conducted = await ConductedAssessment.findById(req.params.id);
    if (!conducted) return sendResponse(res, 404, false, "Conducted assessment not found");

    if (conducted.conductedStages.includes(assessmentTypeId))
      return sendResponse(res, 400, false, "Stage already marked");

    conducted.conductedStages.push(assessmentTypeId);
    conducted.status = conducted.conductedStages.length > 0 ? "in-progress" : "planned";

    await conducted.save();
    await conducted.populate("conductedStages", "name");

    sendResponse(res, 200, true, "Stage marked as conducted", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const updateStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!["planned", "in-progress", "completed"].includes(status))
      return sendResponse(res, 400, false, "Invalid status");

    const conducted = await ConductedAssessment.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!conducted) return sendResponse(res, 404, false, "Not found");

    sendResponse(res, 200, true, "Status updated", conducted);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};