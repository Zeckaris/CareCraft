import { Request, Response } from "express"
import { AssessmentScore } from "../../models/assessment/assessmentScore.model"
import { GradeSubjectAssessment } from "../../models/gradeSubjectAssessment.model"
import { StudentEnrollment } from "../../models/studentEnrollment.model"
import { AssessmentSetup } from "../../models/assessment/assessmentSetup.model"
import { recalcResult,validateConducted } from "../../utils/assessment.utility"
import { AssessmentType } from "../../models/assessment/assessmentType.model"

// BULK GENERATION (Grade + Subject → Auto Setup from GSA)
export const generateBulkScores = async (req: Request, res: Response): Promise<void> => {
    const { gradeId, subjectId } = req.body
    
    if (!gradeId || !subjectId) {
        res.status(400).json({ message: "Missing: gradeId, subjectId" })
        return
    }

    try {
        const gsa = await GradeSubjectAssessment.findOne({ gradeId, subjectId })
        if (!gsa) {
            res.status(400).json({ message: "No assessment setup assigned to this grade/subject" })
            return
        }

        const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate('assessmentTypeIds')
        if (!setup) {
            res.status(404).json({ message: "Assessment setup not found" })
            return
        }

        // Get ACTIVE students (BATCH)
        const enrollments = await StudentEnrollment.find({ 
            gradeId, 
            isActive: true 
        }).populate('studentId')
        const students = enrollments.map(en => en.studentId)

        if (students.length === 0) {
            res.status(400).json({ message: "No active students found" })
            return
        }

        // Generate for ALL (BULK)
        const createdScores: any[] = []
        for (const student of students) {
            const existing = await AssessmentScore.findOne({ 
                studentId: student._id, 
                agsaId: gsa._id
            })
            if (existing) continue

            //  NO isConducted - ONLY score + typeName!
            const scores = setup.assessmentTypeIds.map((type: any) => ({
                assessmentTypeId: type._id,
                typeName: type.name,
                score: 0
            }))

            const scoreDoc = new AssessmentScore({
                studentId: student._id,
                gsaId: gsa._id,
                assessmentSetupId: gsa.assessmentSetupId,  
                scores,
                result: 0
            })
            await scoreDoc.save()
            createdScores.push(scoreDoc._id)
        }

        res.status(201).json({ 
            message: `Generated ${createdScores.length} marksheets`, 
            created: createdScores 
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

// SINGLE GENERATION (Student ID → Auto Setup from GSA)
export const generateSingleScore = async (req: Request, res: Response): Promise<void> => {
    const { studentId, subjectId } = req.body
    
    if (!studentId || !subjectId) {
        res.status(400).json({ message: "Missing: studentId, subjectId" })
        return
    }

    try {
        const enrollment = await StudentEnrollment.findOne({ 
            studentId, 
            isActive: true 
        }).populate('gradeId')
        if (!enrollment) {
            res.status(404).json({ message: "Student not enrolled" })
            return
        }

        const gsa = await GradeSubjectAssessment.findOne({ gradeId: enrollment.gradeId._id, subjectId })
        if (!gsa) {
            res.status(400).json({ message: "No assessment setup for this class" })
            return
        }

        const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate('assessmentTypeIds')
        if (!setup) {
            res.status(404).json({ message: "Assessment setup not found" })
            return
        }

        const existing = await AssessmentScore.findOne({ 
            studentId, 
            gsaId: gsa._id 
        })
        if (existing) {
            res.status(400).json({ message: "Marksheet exists" })
            return
        }

        // ⭐ NO isConducted!
        const scores = setup.assessmentTypeIds.map((type: any) => ({
            assessmentTypeId: type._id,
            typeName: type.name,
            score: 0
        }))

        const scoreDoc = new AssessmentScore({
            studentId,
            gsaId: gsa._id,
            assessmentSetupId: gsa.assessmentSetupId,
            scores,
            result: 0
        })
        await scoreDoc.save()

        res.status(201).json({ message: "Marksheet created", data: scoreDoc })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

// MULTIPLE GENERATION (Student IDs → Auto Setup from GSA)
export const generateMultipleScores = async (req: Request, res: Response): Promise<void> => {
    const { studentIds, subjectId } = req.body
    
    if (!studentIds || !Array.isArray(studentIds) || !subjectId) {
        res.status(400).json({ message: "Missing: studentIds array, subjectId" })
        return
    }

    try {
        const enrollments = await StudentEnrollment.find({ 
            studentId: { $in: studentIds }, 
            isActive: true 
        }).populate('gradeId')

        if (enrollments.length === 0) {
            res.status(404).json({ message: "No active students" })
            return
        }

        const gradeGroups = new Map()
        for (const en of enrollments) {
            const gradeId = en.gradeId._id
            if (!gradeGroups.has(gradeId)) gradeGroups.set(gradeId, [])
            gradeGroups.get(gradeId).push(en.studentId)
        }

        const gsas = await GradeSubjectAssessment.find({ 
            gradeId: { $in: Array.from(gradeGroups.keys()) }, 
            subjectId 
        })
        const createdScores: any[] = []
        for (const [gradeId, students] of gradeGroups) {
            const gsa = gsas.find((g: any) => g.gradeId.equals(gradeId))
            if (!gsa) continue

            const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate('assessmentTypeIds')
            if (!setup) continue

            const scoresTemplate = setup.assessmentTypeIds.map((type: any) => ({
                assessmentTypeId: type._id,
                typeName: type.name,
                score: 0
            }))

            for (const student of students) {
                const existing = await AssessmentScore.findOne({ 
                    studentId: student._id, 
                    gsaId: gsa._id 
                })
                if (existing) continue

                const scoreDoc = new AssessmentScore({
                    studentId: student._id,
                    gsaId: gsa._id,
                    assessmentSetupId: gsa.assessmentSetupId,  
                    scores: scoresTemplate,
                    result: 0
                })
                await scoreDoc.save()
                createdScores.push(scoreDoc._id)
            }
        }

        res.status(201).json({ 
            message: `Generated ${createdScores.length} marksheets`, 
            created: createdScores 
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

// MARK STAGE CONDUCTED (GradeSubjectAssessment ONLY)
export const markStageConducted = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params  
    const { assessmentTypeId } = req.body

    try {
        const gsa = await GradeSubjectAssessment.findById(id)
        if (!gsa) {
            res.status(404).json({ message: "Class assessment not found" })
            return
        }

        const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate('assessmentTypeIds')
        if (!setup) {
            res.status(404).json({ message: "Assessment setup not found" })
            return
        }

        const populatedTypes = setup.assessmentTypeIds as any[]  // ⭐ TYPE FIX!
        const typeIndex = populatedTypes.findIndex((t: any) => t._id.equals(assessmentTypeId))

        // VALIDATE ORDER - No skipping!
        if (typeIndex > gsa.conductedStages.length) {
            const nextExpected = populatedTypes[gsa.conductedStages.length]
            const currentAttempt = populatedTypes[typeIndex]
            res.status(400).json({ 
                message: `Complete "${nextExpected.name}" before "${currentAttempt.name}"`
            })
            return
        }

        if (!gsa.conductedStages.includes(assessmentTypeId)) {
            gsa.conductedStages.push(assessmentTypeId)
            await gsa.save()
        }

        res.status(200).json({ 
            message: "Stage marked conducted", 
            totalStages: gsa.conductedStages.length,
            nextStage: populatedTypes[gsa.conductedStages.length]?.name || "Complete!"
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

// UPDATE SCORES + SMART RECALCULATION (FROM conductedStages)
export const updateAssessmentScore = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { scores } = req.body

    try {
        const scoreDoc = await AssessmentScore.findById(id)
        if (!scoreDoc) {
            res.status(404).json({ message: "Marksheet not found" })
            return
        }

        
        const gsa = await GradeSubjectAssessment.findById(scoreDoc.gsaId)
        if (!gsa) {
            res.status(404).json({ message: "Associated GSA not found" })
            return
        }
        const setup = await AssessmentSetup.findById(scoreDoc.assessmentSetupId).populate('assessmentTypeIds')

        scores?.forEach((update: any) => {
            const scoreIndex = scoreDoc.scores.findIndex(s => s.assessmentTypeId.equals(update.assessmentTypeId))
            if (scoreIndex !== -1) {
                validateConducted(gsa, update.assessmentTypeId, update.typeName)
                scoreDoc.scores[scoreIndex].score = Math.max(0, Math.min(100, update.score))
            }
        })
        
        await recalcResult(scoreDoc, gsa, setup)

        await scoreDoc.save()
        res.status(200).json({ message: "Marksheet updated", data: scoreDoc })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

// GET ALL (Filtering)
export const getAllAssessmentScores = async (req: Request, res: Response): Promise<void> => {
    const { studentId, gradeId, subjectId, assessmentSetupId } = req.query
    
    try {
    const query: any = {}
    if (studentId) query.studentId = studentId
    if (assessmentSetupId) query.assessmentSetupId = assessmentSetupId

    
    if (subjectId) {
        const gsa = await GradeSubjectAssessment.findOne({ subjectId })
        if (gsa) query.gsaId = gsa._id
    }
    if (gradeId) {
        const gsas = await GradeSubjectAssessment.find({ gradeId })
        if (gsas.length > 0) {
            query.gsaId = { $in: gsas.map(g => g._id) }
        }
    }

    const scores = await AssessmentScore.find(query)
        .populate('studentId', 'firstName lastName')
        .populate('gsaId', 'gradeId subjectId') 
        .populate('assessmentSetupId', 'name')
        .sort({ 'studentId.firstName': 1 })

    res.status(200).json({ scores })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getAssessmentScoreById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    
    try {
        const score = await AssessmentScore.findById(id)
            .populate('studentId', 'firstName lastName')
            .populate('gsaId', 'gradeId subjectId')                   
            .populate('assessmentSetupId', 'name assessmentTypeIds')
        if (!score) {
            res.status(404).json({ message: "Marksheet not found" })
            return
        }
        res.status(200).json({ score })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const deleteAssessmentScore = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    
    try {
        const score = await AssessmentScore.findByIdAndDelete(id)
        if (!score) {
            res.status(404).json({ message: "Marksheet not found" })
            return
        }
        res.status(200).json({ message: "Marksheet deleted" })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}


// Batch update ONE type for ALL students 
export const batchUpdateScoresForType = async (req: Request, res: Response): Promise<void> => {
    const { gsaId, assessmentTypeId, scores } = req.body
    
    if (!gsaId || !assessmentTypeId || !scores || !Array.isArray(scores)) {
        res.status(400).json({ message: "Missing: gsaId, assessmentTypeId, scores array" })
        return
    }

    try {
        const gsa = await GradeSubjectAssessment.findById(gsaId)
        if (!gsa) {
            res.status(404).json({ message: "Class assessment not found" })
            return
        }

        const assessmentType = await AssessmentType.findById(assessmentTypeId)
        if (!assessmentType) {
            res.status(404).json({ message: "Assessment type not found" })
            return
        }
        const typeName = assessmentType.name
        validateConducted(gsa, assessmentTypeId, typeName) 

        let updated = 0, errors: any[] = []
        const validScores = scores.filter(s => s.studentId && typeof s.score === 'number')

        for (const { studentId, score } of validScores) {
            try {
                let scoreDoc = await AssessmentScore.findOne({ studentId, gsaId })
                
                if (!scoreDoc) {
                   const setup = await AssessmentSetup.findById(gsa.assessmentSetupId)
                    const scoresTemplate = setup!.assessmentTypeIds.map((typeId: any) => ({
                        assessmentTypeId: typeId,
                        typeName: assessmentType.name,  
                        score: 0
                    }))
                    
                    scoreDoc = new AssessmentScore({
                        studentId,
                        gsaId,
                        assessmentSetupId: gsa.assessmentSetupId,
                        scores: scoresTemplate,
                        result: 0
                    })
                } else {
                    const setup = await AssessmentSetup.findById(gsa.assessmentSetupId)
                    await recalcResult(scoreDoc, gsa, setup)
                }

                const scoreIndex = scoreDoc.scores.findIndex(s => s.assessmentTypeId.equals(assessmentTypeId))
                if (scoreIndex !== -1) {
                    scoreDoc.scores[scoreIndex].score = Math.max(0, Math.min(100, score))
                    const setup = await AssessmentSetup.findById(gsa.assessmentSetupId)
                    await recalcResult(scoreDoc, gsa, setup)  
                    await scoreDoc.save()
                    updated++
                }
            } catch (err: any) {
                errors.push({ studentId, error: err.message })
            }
        }

        const totalSubmitted = scores.length
        const avgScore = validScores.reduce((sum, s) => sum + s.score, 0) / validScores.length || 0

        res.status(200).json({ 
            message: `Batch updated ${updated}/${totalSubmitted} students`,
            stats: { updated, avgScore: Math.round(avgScore), errors: errors.length },
            details: { totalSubmitted, valid: validScores.length }
        })
    } catch (error: any) {
        res.status(error instanceof Error ? 400 : 500).json({ 
            message: error.message || "Internal server error" 
        })
    }
}