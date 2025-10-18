import { Request, Response } from "express"
import { GradeSubjectAssessment } from "../../models/gradeSubjectAssessment.model"
import { AssessmentSetup } from "../../models/assessment/assessmentSetup.model"
import { Subject } from "../../models/subject.model"
import { Grade } from "../../models/grade.model"

// 1. CREATE - UNIQUE Grade+Subject ENFORCED
export const createGradeSubjectAssessment = async (req: Request, res: Response): Promise<void> => {
    const { gradeId, subjectId, assessmentSetupId } = req.body
    
    if (!gradeId || !subjectId) {
        res.status(400).json({ message: "Missing: gradeId, subjectId" })
        return
    }

    try {
        // UNIQUE CHECK - ONLY ONE per Grade+Subject
        const existing = await GradeSubjectAssessment.findOne({ gradeId, subjectId })
        if (existing) {
            res.status(400).json({ 
                message: "Assessment setup already exists for this grade + subject",
                existing: existing._id 
            })
            return
        }

        // AUTO-ASSIGN DEFAULT SETUP IF NONE PROVIDED
        let finalSetupId = assessmentSetupId
        if (!finalSetupId) {
            const defaultSetup = await AssessmentSetup.findOne({ name: "Full Term Assessment" })
            if (!defaultSetup) {
                res.status(500).json({ message: "Default setup not found. Run: npm run seed" })
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
            res.status(400).json({ message: "Invalid grade, subject, or setup ID" })
            return
        }

        const newGSA = new GradeSubjectAssessment({
            gradeId,
            subjectId,
            assessmentSetupId: finalSetupId,
            conductedStages: [] 
        })
        await newGSA.save()

        const populated = await GradeSubjectAssessment.findById(newGSA._id)
            .populate('gradeId', 'level description')
            .populate('subjectId', 'name description')
            .populate('assessmentSetupId', 'name description')

        res.status(201).json({ 
            message: "Grade-Subject assessment created", 
            data: populated,
            usedDefault: !assessmentSetupId  // Shows if auto-used
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getAllGradeSubjectAssessments = async (req: Request, res: Response): Promise<void> => {
    try {
        const gsas = await GradeSubjectAssessment.find()
            .populate('gradeId', 'level description')
            .populate('subjectId', 'name description')
            .populate('assessmentSetupId', 'name description')
            .populate('conductedStages', 'name weight')
            .sort({ 'gradeId.level': 1, 'subjectId.name': 1 })
        
        res.status(200).json({ data: gsas })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getGradeSubjectAssessmentById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    
    try {
        const gsa = await GradeSubjectAssessment.findById(id)
            .populate('gradeId', 'level description')
            .populate('subjectId', 'name description')
            .populate('assessmentSetupId', 'name description')
            .populate('conductedStages', 'name weight')
        
        if (!gsa) {
            res.status(404).json({ message: "Grade-Subject assessment not found" })
            return
        }
        
        res.status(200).json({ data: gsa })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

// FILTER BY GRADE LEVEL
export const getByGradeLevel = async (req: Request, res: Response): Promise<void> => {
    const { level } = req.params
    
    if (!level || isNaN(Number(level))) {
        res.status(400).json({ message: "Valid grade level required" })
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
            .populate('conductedStages', 'name weight')
            .sort({ 'subjectId.name': 1 })
        
        // Filter out null grades
        const validGsas = gsas.filter(gsa => gsa.gradeId !== null)
        
        res.status(200).json({ 
            message: `Assessments for Grade ${level}`,
            count: validGsas.length,
            data: validGsas 
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

// UPDATE - Maintain Uniqueness
export const updateGradeSubjectAssessment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { gradeId, subjectId, assessmentSetupId } = req.body
    
    try {
        const gsa = await GradeSubjectAssessment.findById(id)
        if (!gsa) {
            res.status(404).json({ message: "Grade-Subject assessment not found" })
            return
        }

        if (gradeId && gradeId !== gsa.gradeId.toString()) {
            const existing = await GradeSubjectAssessment.findOne({ 
                gradeId, 
                subjectId: gsa.subjectId 
            })
            if (existing) {
                res.status(400).json({ message: "Assessment setup already exists for new grade + subject" })
                return
            }
        }
        
        if (subjectId && subjectId !== gsa.subjectId.toString()) {
            const existing = await GradeSubjectAssessment.findOne({ 
                gradeId: gsa.gradeId, 
                subjectId 
            })
            if (existing) {
                res.status(400).json({ message: "Assessment setup already exists for grade + new subject" })
                return
            }
        }

        if (assessmentSetupId) {
            const setup = await AssessmentSetup.findById(assessmentSetupId)
            if (!setup) {
                res.status(400).json({ message: "Invalid assessment setup ID" })
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
            .populate('conductedStages', 'name weight')

        res.status(200).json({ 
            message: "Grade-Subject assessment updated", 
            data: populated 
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}


export const deleteGradeSubjectAssessment = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    
    try {
        const gsa = await GradeSubjectAssessment.findByIdAndDelete(id)
        if (!gsa) {
            res.status(404).json({ message: "Grade-Subject assessment not found" })
            return
        }
        
        res.status(200).json({ message: "Grade-Subject assessment deleted" })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}