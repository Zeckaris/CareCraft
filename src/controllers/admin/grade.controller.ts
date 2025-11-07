import { Request, Response } from "express"
import { Grade } from "../../models/grade.model.ts"
import { sendResponse } from "../../utils/sendResponse.util.ts"


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
        sendResponse(res, 200, true, "Grade deleted successfully")
        return
    }catch(error){
        sendResponse(res, 500, false, "Internal server error", null, error)
        return      
    }
}