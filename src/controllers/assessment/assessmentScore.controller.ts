import { Request, Response } from "express"
import { AssessmentScore } from '../../models/assessment/assessmentScore.model.js'
import { GradeSubjectAssessment } from '../../models/gradeSubjectAssessment.model.js'
import { StudentEnrollment } from '../../models/studentEnrollment.model.js'
import { AssessmentSetup } from '../../models/assessment/assessmentSetup.model.js'
import { recalcResult, validateConducted } from '../../utils/assessment.utility.js'
import { AssessmentType } from '../../models/assessment/assessmentType.model.js'
import { sendResponse } from '../../utils/sendResponse.util.js'
import { ConductedAssessment } from '../../models/ConductedAssessment.model.js'
import { Section } from '../../models/section.model.js'
import { AuthRequest } from '../../middlewares/auth.middleware.js'
import { TeachingAssignment } from '../../models/teachingAssignment.model.js'
import mongoose from 'mongoose'

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Finds or creates a ConductedAssessment for a specific GSA + term + section.
 */
async function getOrCreateConducted(
  gsaId: any,
  academicTermId: any,
  sectionId: any
) {
  let conducted = await ConductedAssessment.findOne({ gsaId, academicTermId, sectionId })
  if (!conducted) {
    conducted = new ConductedAssessment({
      gsaId,
      academicTermId,
      sectionId,
      conductedStages: [],
      status: 'planned',
    })
    await conducted.save()
  }
  return conducted
}

/**
 * Verifies that the requesting teacher (if role === 'teacher') has a subject
 * assignment for the given sectionId and subjectId.
 * Admin / coordinator always pass.
 * Returns 403 response and false on failure; returns true on success.
 */
async function assertSubjectTeacherForSection(
  req: AuthRequest,
  res: Response,
  sectionId: any,
  subjectId: any
): Promise<boolean> {
  const user = req.user!
  if (['admin', 'coordinator'].includes(user.role)) return true

  if (user.role === 'teacher') {
    // Get the GSA for this section's grade + subject
    const section = await Section.findById(sectionId).select('gradeId').lean()
    if (!section) {
      sendResponse(res, 404, false, 'Section not found')
      return false
    }
    // Check teacher has a subject assignment for this section and subject
    const assignment = await TeachingAssignment.findOne({
      teacherId: user.id,
      sectionId,
      role: 'subject',
      subjectId,
    }).lean()
    if (!assignment) {
      sendResponse(
        res,
        403,
        false,
        'Forbidden: You are not the subject teacher for this section'
      )
      return false
    }
    return true
  }

  sendResponse(res, 403, false, 'Access denied')
  return false
}

// ─── BULK GENERATION (Section + Subject → Auto Setup from GSA) ───────────────

/**
 * POST /assessment-scores/generate/bulk
 *
 * Body: { sectionId, subjectId }
 *
 * Takes all active students in the given section, finds the GSA for the
 * section's grade + subject, and creates marksheets for any student who
 * doesn't already have one.
 *
 * CHANGED FROM PREVIOUS: gradeId replaced by sectionId. Frontend must send
 * sectionId instead of gradeId.
 */
export const generateBulkScores = async (req: AuthRequest, res: Response): Promise<void> => {
    const { sectionId, subjectId } = req.body

    if (!sectionId || !subjectId) {
        sendResponse(res, 400, false, "Missing: sectionId, subjectId")
        return
    }

    try {
        // Resolve section → grade
        const section = await Section.findById(sectionId).select('gradeId schoolYear').lean()
        if (!section) {
            sendResponse(res, 404, false, "Section not found")
            return
        }

        // Authorization: subject teacher must be assigned to this section + subject
        const ok = await assertSubjectTeacherForSection(req, res, sectionId, subjectId)
        if (!ok) return

        const gsa = await GradeSubjectAssessment.findOne({ gradeId: section.gradeId, subjectId })
        if (!gsa) {
            sendResponse(res, 400, false, "No assessment setup assigned to this grade/subject")
            return
        }

        const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate('assessmentTypeIds')
        if (!setup) {
            sendResponse(res, 404, false, "Assessment setup not found")
            return
        }

        // Get ACTIVE students in the section (not the whole grade)
        const enrollments = await StudentEnrollment.find({
            sectionId,
            isActive: true,
        }).populate('studentId')
        const students = enrollments.map(en => en.studentId)

        if (students.length === 0) {
            sendResponse(res, 400, false, "No active students found in this section")
            return
        }

        // Generate for ALL students in the section
        const createdScores: any[] = []
        for (const student of students) {
            const existing = await AssessmentScore.findOne({
                studentId: (student as any)._id,
                gsaId: gsa._id
            })
            if (existing) continue

            const scores = setup.assessmentTypeIds.map((type: any) => ({
                assessmentTypeId: type._id,
                typeName: type.name,
                score: 0
            }))

            const scoreDoc = new AssessmentScore({
                studentId: (student as any)._id,
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
export const generateSingleScore = async (req: AuthRequest, res: Response): Promise<void> => {
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

        // Authorization: subject teacher must be assigned to the student's section
        if (enrollment.sectionId) {
            const ok = await assertSubjectTeacherForSection(req, res, enrollment.sectionId, subjectId)
            if (!ok) return
        }

        const gsa = await GradeSubjectAssessment.findOne({ gradeId: (enrollment.gradeId as any)._id, subjectId })
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
export const generateMultipleScores = async (req: AuthRequest, res: Response): Promise<void> => {
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
            const gradeId = (en.gradeId as any)._id.toString()
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
                    studentId: (student as any)._id || student,
                    gsaId: gsa._id
                })
                if (existing) continue

                const scoreDoc = new AssessmentScore({
                    studentId: (student as any)._id || student,
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

// MARK STAGE CONDUCTED (per GSA + term + section)
export const markStageConducted = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params // GSA ID
  const { assessmentTypeId, academicTermId, sectionId } = req.body

  if (!assessmentTypeId || !academicTermId || !sectionId) {
    sendResponse(res, 400, false, "Missing: assessmentTypeId, academicTermId, sectionId")
    return
  }

  try {
    const gsa = await GradeSubjectAssessment.findById(id)
    if (!gsa) {
      sendResponse(res, 404, false, "Class assessment not found")
      return
    }

    // Verify section belongs to the GSA's grade
    const section = await Section.findById(sectionId).select('gradeId').lean()
    if (!section) {
      sendResponse(res, 404, false, "Section not found")
      return
    }
    if (section.gradeId.toString() !== gsa.gradeId.toString()) {
      sendResponse(res, 400, false, "Section does not belong to this assessment's grade")
      return
    }

    // Authorization: subject teacher must be assigned to this section + subject
    const ok = await assertSubjectTeacherForSection(req, res, sectionId, gsa.subjectId)
    if (!ok) return

    const setup = await AssessmentSetup.findById(gsa.assessmentSetupId)
      .populate('assessmentTypeIds')
    if (!setup) {
      sendResponse(res, 404, false, "Assessment setup not found")
      return
    }

    // Find or create section-scoped ConductedAssessment
    let conducted = await ConductedAssessment.findOne({
      gsaId: gsa._id,
      academicTermId,
      sectionId,
    })

    if (!conducted) {
      conducted = new ConductedAssessment({
        gsaId: gsa._id,
        academicTermId,
        sectionId,
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

    if (!conducted.conductedStages.some(id => id.equals(assessmentTypeId))) {
      conducted.conductedStages.push(assessmentTypeId)
      conducted.status =
        conducted.conductedStages.length === populatedTypes.length
          ? 'completed'
          : 'in-progress'

      await conducted.save()
    }

    sendResponse(res, 200, true, "Stage marked conducted", {
      sectionId,
      totalStages: conducted.conductedStages.length,
      nextStage:
        populatedTypes[conducted.conductedStages.length]?.name || "Complete!"
    })
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error)
  }
}

// UPDATE SCORES + SMART RECALCULATION (FROM conductedStages per section)
export const updateAssessmentScore = async (req: AuthRequest, res: Response): Promise<void> => {
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

        // Find the student's current section to scope the conducted stages
        const enrollment = await StudentEnrollment.findOne({
            studentId: scoreDoc.studentId,
            isActive: true,
        }).select('sectionId').lean()

        const sectionId = enrollment?.sectionId

        // Authorization: subject teacher must be assigned to this section + subject
        if (sectionId) {
            const ok = await assertSubjectTeacherForSection(req, res, sectionId, gsa.subjectId)
            if (!ok) return
        }

        const setup = await AssessmentSetup.findById(scoreDoc.assessmentSetupId).populate('assessmentTypeIds')

        // Get the section-scoped conducted assessment for score validation
        const currentTermConducted = sectionId
            ? await ConductedAssessment.findOne({
                gsaId: gsa._id,
                sectionId,
              }).sort({ createdAt: -1 }) // most recent term
            : null

        scores?.forEach((update: any) => {
            const scoreIndex = scoreDoc.scores.findIndex(s => s.assessmentTypeId.equals(update.assessmentTypeId))
            if (scoreIndex !== -1) {
                if (currentTermConducted) {
                    validateConducted(currentTermConducted, update.assessmentTypeId, update.typeName)
                }
                scoreDoc.scores[scoreIndex].score = Math.max(0, Math.min(100, update.score))
            }
        })

        await recalcResult(scoreDoc, currentTermConducted || gsa, setup)

        await scoreDoc.save()
        sendResponse(res, 200, true, "Marksheet updated", scoreDoc)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

// GET ALL (Filtering) WITH PAGINATION
export const getAllAssessmentScores = async (req: AuthRequest, res: Response): Promise<void> => {
    const { studentId, gradeId, subjectId, assessmentSetupId } = req.query

    try {
        const page = parseInt(req.query.page as string) || 1
        let limit = parseInt(req.query.limit as string) || 10
        limit = Math.min(limit, 50) // Max 50 per page
        const skip = (page - 1) * limit

        const query: any = {}
        if (studentId) query.studentId = studentId
        if (assessmentSetupId) query.assessmentSetupId = assessmentSetupId

        // Parent: can only see their child's scores
        const user = req.user!
        if (user.role === 'parent') {
            const { Student } = await import('../../models/student.model.js')
            const myStudent = await Student.findOne({ parentId: user.id }).select('_id').lean()
            if (!myStudent) {
                sendResponse(res, 403, false, 'No student linked to your account')
                return
            }
            // Override studentId filter to only own child
            query.studentId = myStudent._id
        } else if (user.role === 'teacher') {
            const { getTeacherSectionIds } = await import('../../middlewares/access.middleware.js')
            const sectionIds = await getTeacherSectionIds(user.id)
            if (sectionIds.length === 0) {
                sendResponse(res, 200, true, "Assessment scores fetched successfully", [], null, {
                    total: 0,
                    page,
                    limit
                })
                return
            }
            const enrollments = await StudentEnrollment.find({
                sectionId: { $in: sectionIds },
                isActive: true,
            }).select('studentId').lean()
            const allowedStudentIds = enrollments.map(e => e.studentId.toString())
            if (query.studentId) {
                if (!allowedStudentIds.includes(query.studentId.toString())) {
                    sendResponse(res, 403, false, "Forbidden: Access denied for this student's scores")
                    return
                }
            } else {
                query.studentId = { $in: allowedStudentIds }
            }
        }

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

export const getAssessmentScoreById = async (req: AuthRequest, res: Response): Promise<void> => {
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

        // Parent / Teacher verification
        const user = req.user!
        if (user.role === 'parent') {
            const { Student } = await import('../../models/student.model.js')
            const student = await Student.findById(score.studentId).select('parentId').lean()
            if (!student || !student.parentId || student.parentId.toString() !== user.id.toString()) {
                sendResponse(res, 403, false, "Forbidden: Not your child's score")
                return
            }
        } else if (user.role === 'teacher') {
            const { assertTeacherCanReadStudent } = await import('../../middlewares/access.middleware.js')
            await assertTeacherCanReadStudent(user.id, score.studentId)
        }

        sendResponse(res, 200, true, "Assessment score fetched successfully", score)
    } catch (error: any) {
        sendResponse(res, error.statusCode || 500, false, error.message || "Internal server error", null, error)
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
export const batchUpdateScoresForType = async (req: AuthRequest, res: Response): Promise<void> => {
    const { gsaId, assessmentTypeId, sectionId, scores } = req.body

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

        // Authorization: subject teacher must be assigned to this section + subject
        if (sectionId) {
            const ok = await assertSubjectTeacherForSection(req, res, sectionId, gsa.subjectId)
            if (!ok) return
        }

        const assessmentType = await AssessmentType.findById(assessmentTypeId)
        if (!assessmentType) {
            sendResponse(res, 404, false, "Assessment type not found")
            return
        }
        const typeName = assessmentType.name

        // Get section-scoped conducted assessment for validation
        const conducted = sectionId
            ? await ConductedAssessment.findOne({ gsaId, sectionId }).sort({ createdAt: -1 })
            : null

        if (conducted) {
            validateConducted(conducted, assessmentTypeId, typeName)
        }

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
                    await recalcResult(scoreDoc, conducted || gsa, setup)
                }

                const scoreIndex = scoreDoc.scores.findIndex(s => s.assessmentTypeId.equals(assessmentTypeId))
                if (scoreIndex !== -1) {
                    scoreDoc.scores[scoreIndex].score = Math.max(0, Math.min(100, score))
                    const setup = await AssessmentSetup.findById(gsa.assessmentSetupId)
                    await recalcResult(scoreDoc, conducted || gsa, setup)
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