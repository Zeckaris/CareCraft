import { Request, Response } from "express"
import { AssessmentScore } from '../../models/assessment/assessmentScore.model.js'
import { GradeSubjectAssessment } from '../../models/gradeSubjectAssessment.model.js'
import { StudentEnrollment } from '../../models/studentEnrollment.model.js'
import { AssessmentSetup } from '../../models/assessment/assessmentSetup.model.js'
import { recalcResult,validateConducted } from '../../utils/assessment.utility.js'
import { AssessmentType } from '../../models/assessment/assessmentType.model.js'
import { sendResponse } from '../../utils/sendResponse.util.js';
import { ConductedAssessment } from '../../models/ConductedAssessment.model.js'

// BULK GENERATION (Grade + Subject → Auto Setup from GSA)
export const generateBulkScores = async (req: Request, res: Response): Promise<void> => {
    const { gradeId, subjectId } = req.body
    
    if (!gradeId || !subjectId) {
        sendResponse(res, 400, false, "Missing: gradeId, subjectId")
        return
    }

    try {
        const gsa = await GradeSubjectAssessment.findOne({ gradeId, subjectId })
        if (!gsa) {
            sendResponse(res, 400, false, "No assessment setup assigned to this grade/subject")
            return
        }

        const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate('assessmentTypeIds')
        if (!setup) {
            sendResponse(res, 404, false, "Assessment setup not found")
            return
        }

        // Get ACTIVE students (BATCH)
        const enrollments = await StudentEnrollment.find({ 
            gradeId, 
            isActive: true 
        }).populate('studentId')
        const students = enrollments.map(en => en.studentId)

        if (students.length === 0) {
            sendResponse(res, 400, false, "No active students found")
            return
        }

        // Generate for ALL (BULK)
        const createdScores: any[] = []
        for (const student of students) {
            const existing = await AssessmentScore.findOne({ 
                studentId: student._id, 
                gsaId: gsa._id
            })
            if (existing) continue

            // NO isConducted - ONLY score + typeName!
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

        sendResponse(res, 201, true, `Generated ${createdScores.length} marksheets`, {
            created: createdScores
        })
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// SINGLE GENERATION (Student ID → Auto Setup from GSA)
export const generateSingleScore = async (req: Request, res: Response): Promise<void> => {
    const { studentId, subjectId } = req.body
    
    if (!studentId || !subjectId) {
        sendResponse(res, 400, false, "Missing: studentId, subjectId")
        return
    }

    try {
        const enrollment = await StudentEnrollment.findOne({ 
            studentId, 
            isActive: true 
        }).populate('gradeId')
        if (!enrollment) {
            sendResponse(res, 404, false, "Student not enrolled")
            return
        }

        const gsa = await GradeSubjectAssessment.findOne({ gradeId: enrollment.gradeId._id, subjectId })
        if (!gsa) {
            sendResponse(res, 400, false, "No assessment setup for this class")
            return
        }

        const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate('assessmentTypeIds')
        if (!setup) {
            sendResponse(res, 404, false, "Assessment setup not found")
            return
        }

        const existing = await AssessmentScore.findOne({ 
            studentId, 
            gsaId: gsa._id 
        })
        if (existing) {
            sendResponse(res, 400, false, "Marksheet exists")
            return
        }

        // NO isConducted!
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

        sendResponse(res, 201, true, "Marksheet created", scoreDoc)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// MULTIPLE GENERATION (Student IDs → Auto Setup from GSA)
export const generateMultipleScores = async (req: Request, res: Response): Promise<void> => {
    const { studentIds, subjectId } = req.body
    
    if (!studentIds || !Array.isArray(studentIds) || !subjectId) {
        sendResponse(res, 400, false, "Missing: studentIds array, subjectId")
        return
    }

    try {
        const enrollments = await StudentEnrollment.find({ 
            studentId: { $in: studentIds }, 
            isActive: true 
        }).populate('gradeId')

        if (enrollments.length === 0) {
            sendResponse(res, 404, false, "No active students")
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

        sendResponse(res, 201, true, `Generated ${createdScores.length} marksheets`, {
            created: createdScores
        })
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// MARK STAGE CONDUCTED (GradeSubjectAssessment ONLY)
export const markStageConducted = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params // GSA ID
  const { assessmentTypeId, academicTermId } = req.body

  if (!assessmentTypeId || !academicTermId) {
    sendResponse(res, 400, false, "Missing: assessmentTypeId, academicTermId")
    return
  }

  try {
    const gsa = await GradeSubjectAssessment.findById(id)
    if (!gsa) {
      sendResponse(res, 404, false, "Class assessment not found")
      return
    }

    const setup = await AssessmentSetup.findById(gsa.assessmentSetupId)
      .populate('assessmentTypeIds')
    if (!setup) {
      sendResponse(res, 404, false, "Assessment setup not found")
      return
    }

    // Find or create ConductedAssessment
    let conducted = await ConductedAssessment.findOne({
      gsaId: gsa._id,
      academicTermId
    })

    if (!conducted) {
      conducted = new ConductedAssessment({
        gsaId: gsa._id,
        academicTermId,
        conductedStages: [],
        status: 'planned'
      })
    }

    const populatedTypes = setup.assessmentTypeIds as any[]
    const typeIndex = populatedTypes.findIndex(
      (t: any) => t._id.equals(assessmentTypeId)
    )

    if (typeIndex === -1) {
      sendResponse(res, 400, false, "Invalid assessment type")
      return
    }

    // VALIDATE ORDER — NO SKIPPING
    if (typeIndex > conducted.conductedStages.length) {
      const nextExpected = populatedTypes[conducted.conductedStages.length]
      const currentAttempt = populatedTypes[typeIndex]
      sendResponse(
        res,
        400,
        false,
        `Complete "${nextExpected.name}" before "${currentAttempt.name}"`
      )
      return
    }

    if (!conducted.conductedStages.some(id =>
      id.equals(assessmentTypeId)
    )) {
      conducted.conductedStages.push(assessmentTypeId)
      conducted.status =
        conducted.conductedStages.length === populatedTypes.length
          ? 'completed'
          : 'in-progress'

      await conducted.save()
    }

    sendResponse(res, 200, true, "Stage marked conducted", {
      totalStages: conducted.conductedStages.length,
      nextStage:
        populatedTypes[conducted.conductedStages.length]?.name || "Complete!"
    })
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error)
  }
}

// UPDATE SCORES + SMART RECALCULATION (FROM conductedStages)
export const updateAssessmentScore = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { scores } = req.body

    try {
        const scoreDoc = await AssessmentScore.findById(id)
        if (!scoreDoc) {
            sendResponse(res, 404, false, "Marksheet not found")
            return
        }

        const gsa = await GradeSubjectAssessment.findById(scoreDoc.gsaId)
        if (!gsa) {
            sendResponse(res, 404, false, "Associated GSA not found")
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
        sendResponse(res, 200, true, "Marksheet updated", scoreDoc)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// GET ALL (Filtering) WITH PAGINATION
export const getAllAssessmentScores = async (req: Request, res: Response): Promise<void> => {
    const { studentId, gradeId, subjectId, assessmentSetupId } = req.query
    
    try {
        // Pagination setup
        const page = parseInt(req.query.page as string) || 1
        let limit = parseInt(req.query.limit as string) || 10
        limit = Math.min(limit, 50) // Max 50 per page
        const skip = (page - 1) * limit

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

        const total = await AssessmentScore.countDocuments(query)
        const scores = await AssessmentScore.find(query)
            .populate('studentId', 'firstName lastName')
            .populate('gsaId', 'gradeId subjectId') 
            .populate('assessmentSetupId', 'name')
            .sort({ 'studentId.firstName': 1 })
            .skip(skip)
            .limit(limit)

        sendResponse(res, 200, true, "Assessment scores fetched successfully", scores, null, {
            total,
            page,
            limit
        })
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
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
            sendResponse(res, 404, false, "Marksheet not found")
            return
        }
        sendResponse(res, 200, true, "Assessment score fetched successfully", score)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const deleteAssessmentScore = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    
    try {
        const score = await AssessmentScore.findByIdAndDelete(id)
        if (!score) {
            sendResponse(res, 404, false, "Marksheet not found")
            return
        }
        sendResponse(res, 200, true, "Marksheet deleted")
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// Batch update ONE type for ALL students 
export const batchUpdateScoresForType = async (req: Request, res: Response): Promise<void> => {
    const { gsaId, assessmentTypeId, scores } = req.body
    
    if (!gsaId || !assessmentTypeId || !scores || !Array.isArray(scores)) {
        sendResponse(res, 400, false, "Missing: gsaId, assessmentTypeId, scores array")
        return
    }

    try {
        const gsa = await GradeSubjectAssessment.findById(gsaId)
        if (!gsa) {
            sendResponse(res, 404, false, "Class assessment not found")
            return
        }

        const assessmentType = await AssessmentType.findById(assessmentTypeId)
        if (!assessmentType) {
            sendResponse(res, 404, false, "Assessment type not found")
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

        sendResponse(res, 200, true, `Batch updated ${updated}/${totalSubmitted} students`, {
            stats: { updated, avgScore: Math.round(avgScore), errors: errors.length },
            details: { totalSubmitted, valid: validScores.length },
            errors: errors.length > 0 ? errors : undefined
        })
    } catch (error: any) {
        sendResponse(res, error instanceof Error ? 400 : 500, false, error.message || "Internal server error", null, error)
    }
}