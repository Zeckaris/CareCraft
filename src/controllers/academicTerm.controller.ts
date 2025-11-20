import { Request, Response } from "express";
import { AcademicTerm } from "../models/academicTerm.model";
import { sendResponse } from "../utils/sendResponse.util";



export const getAllTerms = async (req: Request, res: Response) => {
  try {
    const terms = await AcademicTerm.find()
      .populate("calendarId", "academicYear")
      .sort({ "calendarId.academicYear": -1, sequence: 1 });
    sendResponse(res, 200, true, "All terms fetched", terms);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const getCurrentTerm = async (req: Request, res: Response) => {
  try {
    const term = await AcademicTerm.findOne({ isCurrent: true })
      .populate("calendarId", "academicYear startDate endDate");
    sendResponse(res, 200, true, "Current term", term);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const getTermsByCalendar = async (req: Request, res: Response) => {
  try {
    const terms = await AcademicTerm.find({ calendarId: req.params.calendarId })
      .sort({ sequence: 1 });
    sendResponse(res, 200, true, "Terms for calendar", terms);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const getTermById = async (req: Request, res: Response) => {
  try {
    const term = await AcademicTerm.findById(req.params.id)
      .populate("calendarId", "academicYear");
    if (!term) return sendResponse(res, 404, false, "Term not found");
    sendResponse(res, 200, true, "Term found", term);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const createTerm = async (req: Request, res: Response) => {
  try {
    const { calendarId, name, sequence, startDate, endDate } = req.body;
    if (!calendarId || !name || sequence === undefined || !startDate || !endDate)
      return sendResponse(res, 400, false, "Missing required fields");

    const term = await AcademicTerm.create({
      calendarId,
      name,
      sequence,
      startDate,
      endDate,
    });
    sendResponse(res, 201, true, "Term created", term);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const updateTerm = async (req: Request, res: Response) => {
  try {
    const term = await AcademicTerm.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!term) return sendResponse(res, 404, false, "Term not found");
    sendResponse(res, 200, true, "Term updated", term);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const setCurrentTerm = async (req: Request, res: Response) => {
  try {
    const term = await AcademicTerm.findById(req.params.id);
    if (!term) return sendResponse(res, 404, false, "Term not found");

    term.isCurrent = true;
    await term.save(); // pre-save hook clears others

    sendResponse(res, 200, true, "Current term updated", term);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const deleteTerm = async (req: Request, res: Response) => {
  try {
    const term = await AcademicTerm.findById(req.params.id);
    if (!term) return sendResponse(res, 404, false, "Term not found");
    if (term.isCurrent)
      return sendResponse(res, 400, false, "Cannot delete current term");

    await AcademicTerm.deleteOne({ _id: req.params.id });
    sendResponse(res, 200, true, "Term deleted");
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};