import { Request, Response } from "express"
import { GradeSubjectAssessment } from "../../models/gradeSubjectAssessment.model.ts"
import { AssessmentSetup } from "../../models/assessment/assessmentSetup.model.ts"
import { Subject } from "../../models/subject.model.ts"
import { Grade } from "../../models/grade.model.ts"
import { sendResponse } from '../../utils/sendResponse.util.ts'



export const createGradeSubjectAssessment = async (req: Request, res: Response): Promise<void> => {
    const { gradeId, subjectId, assessmentSetupId } = req.body
    
    if (!gradeId || !subjectId) {
        sendResponse(res, 400, false, "Missing: gradeId, subjectId")
        return
    }

    try {
        // UNIQUE CHECK - ONLY ONE per Grade+Subject
        const existing = await GradeSubjectAssessment.findOne({ gradeId, subjectId })
        if (existing) {
            sendResponse(res, 400, false, "Assessment setup already exists for this grade + subject", {
                existing: existing._id 
            })
            return
        }

        // AUTO-ASSIGN DEFAULT SETUP IF NONE PROVIDED
        let finalSetupId = assessmentSetupId
        if (!finalSetupId) {
            const defaultSetup = await AssessmentSetup.findOne({ name: "Full Term Assessment" })
            if (!defaultSetup) {
                sendResponse(res, 500, false, "Default setup not found. Run: npm run seed")
                return
            }
            finalSetupId = defaultSetup._id
            console.log("AUTO-ASSIGNED default setup:", defaultSetup.name)
        }

        // VALIDATE REFERENCES
        const grade = await Grade.findById(gradeId)
        const subject = await Subject.findById(subjectId)
        const setup = await AssessmentSetup.findById(finalSetupId)
        
        if (!grade || !subject || !setup) {
            sendResponse(res, 400, false, "Invalid grade, subject, or setup ID")
            return
        }

        const newGSA = new GradeSubjectAssessment({
            gradeId,
            subjectId,
            assessmentSetupId: finalSetupId
            // conductedStages removed
        })
        await newGSA.save()

        const populated = await GradeSubjectAssessment.findById(newGSA._id)
            .populate('gradeId', 'level description')
            .populate('subjectId', 'name description')
            .populate('assessmentSetupId', 'name description')
            // .populate('conductedStages', 'name weight') → removed

        sendResponse(res, 201, true, "Grade-Subject assessment created", {
            gsa: populated,
            usedDefault: !assessmentSetupId
        })
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const getAllGradeSubjectAssessments = async (req: Request, res: Response): Promise<void> => {
    try {
        const page = parseInt(req.query.page as string) || 1
        let limit = parseInt(req.query.limit as string) || 10
        limit = Math.min(limit, 50)
        const skip = (page - 1) * limit

        const total = await GradeSubjectAssessment.countDocuments()
        const gsas = await GradeSubjectAssessment.find()
            .populate('gradeId', 'level description')
            .populate('subjectId', 'name description')
            .populate('assessmentSetupId', 'name description')
            // .populate('conductedStages', 'name weight') → removed
            .sort({ 'gradeId.level': 1, 'subjectId.name': 1 })
            .skip(skip)
            .limit(limit)
        
        sendResponse(res, 200, true, "Grade-Subject assessments fetched successfully", gsas, null, {
            total,
            page,
            limit
        })
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const getGradeSubjectAssessmentById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    
    try {
        const gsa = await GradeSubjectAssessment.findById(id)
            .populate('gradeId', 'level description')
            .populate('subjectId', 'name description')
            .populate('assessmentSetupId', 'name description')
            // .populate('conductedStages', 'name weight') → removed
        
        if (!gsa) {
            sendResponse(res, 404, false, "Grade-Subject assessment not found")
            return
        }
        
        sendResponse(res, 200, true, "Grade-Subject assessment fetched successfully", gsa)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const getByGradeLevel = async (req: Request, res: Response): Promise<void> => {
    const { level } = req.params
    
    if (!level || isNaN(Number(level))) {
        sendResponse(res, 400, false, "Valid grade level required")
        return
    }

    try {
        const gsas = await GradeSubjectAssessment.find()
            .populate({
                path: 'gradeId',
                match: { level: Number(level) },
                select: 'level description'
            })
            .populate('subjectId', 'name description')
            .populate('assessmentSetupId', 'name description')
            // .populate('conductedStages', 'name weight') → removed
            .sort({ 'subjectId.name': 1 })
        
        const validGsas = gsas.filter(gsa => gsa.gradeId !== null)
        
        sendResponse(res, 200, true, `Assessments for Grade ${level}`, {
            count: validGsas.length,
            gsas: validGsas 
        })
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const updateGradeSubjectAssessment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { gradeId, subjectId, assessmentSetupId } = req.body
    
    try {
        const gsa = await GradeSubjectAssessment.findById(id)
        if (!gsa) {
            sendResponse(res, 404, false, "Grade-Subject assessment not found")
            return
        }

        if (gradeId && gradeId !== gsa.gradeId.toString()) {
            const existing = await GradeSubjectAssessment.findOne({ 
                gradeId, 
                subjectId: gsa.subjectId 
            })
            if (existing) {
                sendResponse(res, 400, false, "Assessment setup already exists for new grade + subject")
                return
            }
        }
        
        if (subjectId && subjectId !== gsa.subjectId.toString()) {
            const existing = await GradeSubjectAssessment.findOne({ 
                gradeId: gsa.gradeId, 
                subjectId 
            })
            if (existing) {
                sendResponse(res, 400, false, "Assessment setup already exists for grade + new subject")
                return
            }
        }

        if (assessmentSetupId) {
            const setup = await AssessmentSetup.findById(assessmentSetupId)
            if (!setup) {
                sendResponse(res, 400, false, "Invalid assessment setup ID")
                return
            }
        }

        gsa.gradeId = gradeId || gsa.gradeId
        gsa.subjectId = subjectId || gsa.subjectId
        gsa.assessmentSetupId = assessmentSetupId || gsa.assessmentSetupId
        
        await gsa.save()

        const populated = await GradeSubjectAssessment.findById(id)
            .populate('gradeId', 'level description')
            .populate('subjectId', 'name description')
            .populate('assessmentSetupId', 'name description')
            // .populate('conductedStages', 'name weight') → removed

        sendResponse(res, 200, true, "Grade-Subject assessment updated", populated)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// delete function unchanged — no conductedStages reference
export const deleteGradeSubjectAssessment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    
    try {
        const gsa = await GradeSubjectAssessment.findByIdAndDelete(id)
        if (!gsa) {
            sendResponse(res, 404, false, "Grade-Subject assessment not found")
            return
        }
        
        sendResponse(res, 200, true, "Grade-Subject assessment deleted")
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}