import { Request, Response } from "express"
import { Grade } from '../../models/grade.model.js'
import { sendResponse } from '../../utils/sendResponse.util.js'
import { Types } from "mongoose"
import { StudentEnrollment } from '../../models/studentEnrollment.model.js'


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

export const deleteGrade= async (req:Request, res:Response):Promise<void> =>{
    const {id}= req.params
    if (!id){
        sendResponse(res, 400, false, "Missing required field")
        return
    }

    try{
        const grade= await Grade.findByIdAndDelete(id)
        if (!grade){
            sendResponse(res, 404, false, "Grade not found")
            return
        }
        const enrollmentCount = await StudentEnrollment.countDocuments({ gradeId: id });
        if (enrollmentCount > 0) {
        sendResponse(
            res,
            400,
            false,
            `Cannot delete "${grade.level}" — ${enrollmentCount} enrollment(s) linked. Remove them first.`
        );
        return;
        }
        sendResponse(res, 200, true, "Grade deleted successfully")
        return
    }catch(error){
        sendResponse(res, 500, false, "Internal server error", null, error)
        return      
    }
}