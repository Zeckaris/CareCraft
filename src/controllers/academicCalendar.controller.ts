import { Request, Response } from "express";
import { AcademicCalendar } from '../models/academicCalendar.model.js';
import { sendResponse } from '../utils/sendResponse.util.js';

export const getAllCalendars = async (req: Request, res: Response) => {
  try {
    const calendars = await AcademicCalendar.find().sort({ academicYear: -1 });
    sendResponse(res, 200, true, "Academic calendars fetched", calendars);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null,  error);
  }
};


export const getCurrentCalendar = async (req: Request, res: Response) => {
  try {
    const calendar = await AcademicCalendar.findOne({ isCurrent: true });
    sendResponse(res, 200, true, "Current calendar", calendar);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const getCalendarById = async (req: Request, res: Response) => {
  try {
    const calendar = await AcademicCalendar.findById(req.params.id);
    if (!calendar) return sendResponse(res, 404, false, "Calendar not found");
    sendResponse(res, 200, true, "Calendar found", calendar);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const createCalendar = async (req: Request, res: Response) => {
  try {
    const { 
      academicYear, 
      startDate, 
      endDate,
      registrationStartDate,
      registrationEndDate,
      newStudentRegistrationStartDate,
      newStudentRegistrationEndDate,
      holidayDates
    } = req.body;

    if (!academicYear || !startDate || !endDate)
      return sendResponse(res, 400, false, "Missing required fields");

    const exists = await AcademicCalendar.findOne({ academicYear });
    if (exists) return sendResponse(res, 400, false, "Academic year already exists");

    const calendar = await AcademicCalendar.create({ 
      academicYear, 
      startDate, 
      endDate,
      registrationStartDate,
      registrationEndDate,
      newStudentRegistrationStartDate,
      newStudentRegistrationEndDate,
      holidayDates: holidayDates || [] 
    });

    sendResponse(res, 201, true, "Academic calendar created", calendar);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const updateCalendar = async (req: Request, res: Response) => {
  try {
    const calendar = await AcademicCalendar.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    if (!calendar) return sendResponse(res, 404, false, "Calendar not found");
    sendResponse(res, 200, true, "Calendar updated", calendar);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const setCurrentCalendar = async (req: Request, res: Response) => {
  try {
    const calendar = await AcademicCalendar.findById(req.params.id);
    if (!calendar) return sendResponse(res, 404, false, "Calendar not found");

    calendar.isCurrent = true;
    await calendar.save(); 

    sendResponse(res, 200, true, "Current academic year updated", calendar);
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};


export const deleteCalendar = async (req: Request, res: Response) => {
  try {
    const calendar = await AcademicCalendar.findById(req.params.id);
    if (!calendar) return sendResponse(res, 404, false, "Calendar not found");
    if (calendar.isCurrent)
      return sendResponse(res, 400, false, "Cannot delete current calendar");

    await AcademicCalendar.deleteOne({ _id: req.params.id });
    sendResponse(res, 200, true, "Calendar deleted");
  } catch (error) {
    sendResponse(res, 500, false, "Server error", null, error);
  }
};