import { Request, Response } from "express"
import { Grade } from '../../models/grade.model.js'
import { sendResponse } from '../../utils/sendResponse.util.js'
import { Types } from "mongoose"
import { StudentEnrollment } from '../../models/studentEnrollment.model.js'
import { Section } from '../../models/section.model.js'
import { GradeSubjectAssessment } from '../../models/gradeSubjectAssessment.model.js'
import { BadgeDefinition } from '../../models/badgeDefinition.model.js'
import { ScheduleEntry } from '../../models/scheduleEntry.model.js'
import { WeeklyPeriodRequirement } from '../../models/weeklyPeriodRequirement.model.js'
import { guardDeleteReferences, ReferenceCheck } from '../../utils/referenceGuard.util.js'


export const createGrade= async (req:Request, res:Response):Promise<void> =>{

    const {level, description}= req.body
    if (!level){
        sendResponse(res, 400, false, "Missing required field")
        return;
    }
    try{
        const grade= await Grade.findOne({level: level})
        if (grade){
            sendResponse(res, 400, false, "Grade already exists")
            return
        }

        const newGrade = new Grade({level, description})
        await newGrade.save()
        sendResponse(res, 201, true, "Grade created successfully", newGrade)
    }catch(error){
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}


export const getAllGrades = async (req: Request, res: Response):Promise<void> =>{
    try{
        const grades = await Grade.find()
        sendResponse(res, 200, true, "Grades fetched successfully", grades)
        return
    }catch(error){
        sendResponse(res, 500, false, "Internal server error", null, error)
        return
    }
}

export const getGradeById= async (req:Request, res:Response):Promise<void> =>{
    const {id}= req.params
    if (!id){
        sendResponse(res, 400, false, "Missing required field")
        return
    }

    try{
        const grade= await Grade.findById(id)
        if (!grade){
             sendResponse(res, 404, false, "Grade not found")
            return
        }
        sendResponse(res, 200, true, "Grade fetched successfully", grade)
        return
    }catch(error){
        sendResponse(res, 500, false, "Internal server error", null, error)
        return
    }
}

export const updateGrade = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { level, description } = req.body;
  if (!id || !Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, "Invalid grade ID");
    return;
  }

  if (!level || typeof level !== 'string') {
    sendResponse(res, 400, false, "Level is required and must be a string");
    return;
  }

  try {
    const existingGrade = await Grade.findOne({ 
      level: level.trim(), 
      _id: { $ne: id } 
    });

    if (existingGrade) {
      sendResponse(res, 400, false, "A grade with this level already exists");
      return;
    }

    const updatedGrade = await Grade.findByIdAndUpdate(
      id,
      { 
        level: level.trim(), 
        description: description?.trim() || null 
      },
      { new: true, runValidators: true }
    );

    if (!updatedGrade) {
      sendResponse(res, 404, false, "Grade not found");
      return;
    }

    sendResponse(res, 200, true, "Grade updated successfully", updatedGrade);
  } catch (error) {
    console.error("Update grade error:", error);
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};

export const deleteGrade = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!id || !Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Valid grade ID required')
    return
  }

  try {
    const grade = await Grade.findById(id)
    if (!grade) {
      sendResponse(res, 404, false, 'Grade not found')
      return
    }

    const referenceChecks: ReferenceCheck[] = [
      {
        model: StudentEnrollment,
        field: 'gradeId',
        filter: { isActive: true },
        label: 'active enrollment(s)',
      },
      {
        model: StudentEnrollment,
        field: 'gradeId',
        filter: { isActive: false },
        label: 'inactive enrollment(s)',
      },
      { model: Section, field: 'gradeId', label: 'section(s)' },
      {
        model: GradeSubjectAssessment,
        field: 'gradeId',
        label: 'grade-subject assessment(s)',
      },
      { model: BadgeDefinition, field: 'eligibleGrades', label: 'badge definition(s)' },
      {
        model: ScheduleEntry,
        field: 'gradeId',
        label: 'schedule entry(ies)',
        excludeArchivedSchedules: true,
      },
      {
        model: WeeklyPeriodRequirement,
        field: 'gradeId',
        label: 'weekly period requirement(s)',
      },
    ]

    if (await guardDeleteReferences(res, 'grade', id, referenceChecks)) return

    await Grade.findByIdAndDelete(id)
    sendResponse(res, 200, true, 'Grade deleted successfully')
    return
  } catch (error) {
    sendResponse(res, 500, false, 'Internal server error', null, error)
    return
  }
}