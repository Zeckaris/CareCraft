import { Request, Response } from "express"
import { Grade } from "../../models/grade.model"


export const createGrade= async (req:Request, res:Response):Promise<void> =>{

    const {level, description}= req.body
    if (!level){
        res.status(400).json({message : "Missing required field"})
    }
    try{
        const grade= await Grade.find({level: level})
        if (grade){
            res.status(400).json({message : "Grade already exists"})
            return
        }

        const newGrade = new Grade({level, description})
        await newGrade.save()
        res.status(201).json({message : "Grade created successfully", data: newGrade})
    }catch(error){
        res.status(500).json({message : "Internal server error", error})
    }
}


export const getAllGrades = async (req: Request, res: Response):Promise<void> =>{
    try{
        const grades = await Grade.find()
        res.status(200).json({grades})
        return
    }catch(error){
        res.status(500).json({message : "Internal server error", error})
        return
    }
}

export const getGradeById= async (req:Request, res:Response):Promise<void> =>{
    const {id}= req.params
    if (!id){
        res.status(400).json({message : "Missing required field"})
        return
    }

    try{
        const grade= await Grade.findById(id)
        if (!grade){
            res.status(404).json({message : "Grade not found"})
            return
        }
        res.status(200).json({grade})
        return
    }catch(error){
        res.status(500).json({message : "Internal server error", error})
        return
    }
}

export const deleteGrade= async (req:Request, res:Response):Promise<void> =>{
    const {id}= req.params
    if (!id){
        res.status(400).json({message : "Missing required field"})
        return
    }

    try{
        const grade= await Grade.findByIdAndDelete(id)
        if (!grade){
            res.status(404).json({message : "Grade not found"})
            return
        }
        res.status(200).json({message : "Grade deleted successfully"})
        return
    }catch(error){
        res.status(500).json({message : "Internal server error", error})
        return      
    }
}