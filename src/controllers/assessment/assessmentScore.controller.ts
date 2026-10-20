/**
 * assessmentScore.controller.ts
 *
 * Teacher-facing assessment scoring and class sheet.
 *
 * Flow: a subject teacher opens the class sheet for a section + subject +
 * term, conducts a stage (in setup order), enters scores (offline-safe batch
 * write), then completes the stage to lock it. Admins/coordinators can reopen
 * a locked stage.
 */

import { Response } from 'express'
import mongoose from 'mongoose'
import { AssessmentScore } from '../../models/assessment/assessmentScore.model.js'
import { GradeSubjectAssessment } from '../../models/gradeSubjectAssessment.model.js'
import { StudentEnrollment } from '../../models/studentEnrollment.model.js'
import { Student } from '../../models/student.model.js'
import { AcademicTerm } from '../../models/academicTerm.model.js'
import { ConductedAssessment } from '../../models/ConductedAssessment.model.js'
import { sendResponse } from '../../utils/sendResponse.util.js'
import { sortByStudentName } from '../../utils/studentSort.util.js'
import { computeTotals } from '../../utils/assessment.utility.js'
import { logAudit } from '../../utils/auditLogger.util.js'
import { AuthRequest } from '../../middlewares/auth.middleware.js'
import { getCurrentTerm } from '../../service/currentAcademic.service.js'
import {
  AssessmentError,
  resolveAssessmentContext,
  isSubjectTeacherForSection,
  writeStageScores,
  recalcMarksheetsForSectionTerm,
  syncConductedStatus,
  StageSubmissionRecord,
} from '../../service/assessmentScore.service.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

function handleError(res: Response, error: unknown): void {
  if (error instanceof AssessmentError) {
    sendResponse(res, error.status, false, error.message)
    return
  }
  sendResponse(
    res,
    500,
    false,
    'Internal server error',
    null,
    error instanceof Error ? error.message : error
  )
}

async function findGsaSubject(gsaId: any): Promise<any | null> {
  return GradeSubjectAssessment.findById(gsaId).select('gradeId subjectId').lean()
}

const refId = (value: any): any => (value && value._id ? value._id : value)

/**
 * Loads the locked-stage set and the setup's type weights for a marksheet's
 * scope. Used to build the locked-only view shown to non-teachers.
 */
async function loadLockedVisibility(
  gsaId: any,
  sectionId: any,
  academicTermId: any
): Promise<{ lockedStageIds: Set<string>; typeWeightById: Map<string, number> }> {
  const gsa = await GradeSubjectAssessment.findById(gsaId)
    .populate({ path: 'assessmentSetupId', populate: { path: 'assessmentTypeIds' } })
    .lean()

  const types = (((gsa as any)?.assessmentSetupId?.assessmentTypeIds ?? []) as any[]).filter(
    (t) => t && typeof t === 'object' && t._id
  )
  const typeWeightById = new Map<string, number>(
    types.map((t: any) => [String(t._id), Number(t.weight) || 0])
  )

  const conducted = await ConductedAssessment.findOne({
    gsaId,
    sectionId,
    academicTermId,
  }).lean()

  return {
    lockedStageIds: toIdSet(conducted?.lockedStages),
    typeWeightById,
  }
}

/**
 * Returns a copy of the marksheet containing only locked stages, with total and
 * average recomputed from those stages. Unlocked marks never leave the server.
 */
function restrictToLockedStages(
  score: any,
  lockedStageIds: Set<string>,
  typeWeightById: Map<string, number>
): any {
  const obj = typeof score.toObject === 'function' ? score.toObject() : { ...score }
  const visibleScores = (obj.scores ?? []).filter((s: any) =>
    lockedStageIds.has(String(s.assessmentTypeId))
  )
  const totals = computeTotals(visibleScores, typeWeightById, lockedStageIds)
  return {
    ...obj,
    scores: visibleScores,
    total: totals.total,
    average: totals.average,
  }
}

function stageState(
  conducted: any,
  assessmentTypeId: string
): 'not-conducted' | 'conducted' | 'locked' {
  if (!conducted) return 'not-conducted'
  const conductedIds = (conducted.conductedStages ?? []).map((id: any) => String(id))
  if (!conductedIds.includes(assessmentTypeId)) return 'not-conducted'
  const lockedIds = (conducted.lockedStages ?? []).map((id: any) => String(id))
  return lockedIds.includes(assessmentTypeId) ? 'locked' : 'conducted'
}

/**
 * Resolves the academic term, defaulting to the current term when the caller
 * does not supply one.
 */
async function resolveTermId(academicTermId?: string): Promise<string> {
  if (academicTermId) {
    if (!mongoose.isValidObjectId(academicTermId)) {
      throw new AssessmentError(400, 'Invalid academicTermId')
    }
    return academicTermId
  }
  const current = await getCurrentTerm()
  if (!current) {
    throw new AssessmentError(404, 'No current academic term is available based on calendar dates')
  }
  return String(current._id)
}

const parseBody = (req: AuthRequest) => {
  const { sectionId, subjectId, academicTermId, assessmentTypeId, records } = req.body ?? {}
  return { sectionId, subjectId, academicTermId, assessmentTypeId, records }
}

// ─── CLASS SHEET / RESULTS READ ──────────────────────────────────────────────

const toIdSet = (ids: any[] | undefined | null): Set<string> =>
  new Set((ids ?? []).map((id: any) => String(id)))

/**
 * Builds the class-sheet payload for a resolved context.
 *
 * `visibleStageIds` is the set of stages whose marks may be returned, and is
 * also the set used for total/average. A teacher passes the conducted stages;
 * the admin/coordinator results read passes only the LOCKED stages, so marks of
 * conducted-but-unlocked stages can never reach a non-teacher caller — not in
 * the cells and not in the totals.
 */
async function buildSheet(
  ctx: any,
  academicTermId: string,
  visibleStageIds: Set<string>,
  includeUpdatedAt: boolean
) {
  const conducted = ctx.conducted
  const conductedStageIds = toIdSet(conducted?.conductedStages)
  const lockedStageIds = toIdSet(conducted?.lockedStages)

  const columns = ctx.types.map((type: any, order: number) => {
    const typeId = String(type._id)
    const state: 'not-conducted' | 'conducted' | 'locked' = !conductedStageIds.has(typeId)
      ? 'not-conducted'
      : lockedStageIds.has(typeId)
        ? 'locked'
        : 'conducted'
    const maxScore = Number(type.weight) || 0
    return {
      typeId,
      name: type.name,
      weight: maxScore,
      maxScore,
      order,
      state,
    }
  })

  const [enrollments, marksheets] = await Promise.all([
    StudentEnrollment.find({ sectionId: ctx.section._id, isActive: true })
      .populate('studentId', 'firstName middleName lastName')
      .lean(),
    AssessmentScore.find({
      gsaId: ctx.gsa._id,
      sectionId: ctx.section._id,
      academicTermId,
    }).lean(),
  ])

  const marksheetByStudent = new Map<string, any>()
  for (const m of marksheets) {
    marksheetByStudent.set(String(m.studentId), m)
  }

  const students = enrollments
    .filter((e: any) => e.studentId)
    .map((e: any) => {
      const student = e.studentId
      const marksheet = marksheetByStudent.get(String(student._id)) ?? null

      const cells: Record<string, { score: number | null; entered: boolean }> = {}
      for (const col of columns) {
        // Stages outside the visible set (e.g. unlocked stages for admin) are
        // always hidden, whatever the underlying marksheet holds.
        if (!visibleStageIds.has(col.typeId)) {
          cells[col.typeId] = { score: null, entered: false }
          continue
        }
        const entry = marksheet?.scores?.find(
          (s: any) => String(s.assessmentTypeId) === col.typeId
        )
        cells[col.typeId] = {
          score: entry ? Number(entry.score) : 0,
          entered: !!entry,
        }
      }

      // computeTotals ignores any entry whose type is not in the set, so passing
      // the full marksheet is safe: only visible stages count.
      const totals = computeTotals(
        marksheet?.scores ?? [],
        ctx.typeWeightById,
        visibleStageIds
      )

      return {
        studentId: student._id,
        firstName: student.firstName,
        middleName: student.middleName ?? null,
        lastName: student.lastName,
        scores: cells,
        total: totals.total,
        average: totals.average,
        updatedAt: includeUpdatedAt ? marksheet?.updatedAt ?? null : null,
      }
    })

  return {
    columns,
    students: sortByStudentName(students),
    conductedStageIds,
    lockedStageIds,
  }
}

/**
 * GET /api/assessment/scores/class-sheet?sectionId=&subjectId=&academicTermId=
 *
 * Roles: subject teacher of the section+subject only. Shows full marks for all
 * conducted stages. Admins/coordinators use /results (locked stages only).
 */
export const getClassSheet = async (req: AuthRequest, res: Response): Promise<void> => {
  const { sectionId, subjectId } = req.query as Record<string, string>
  try {
    if (!mongoose.isValidObjectId(sectionId)) {
      throw new AssessmentError(400, 'Invalid sectionId')
    }
    if (!mongoose.isValidObjectId(subjectId)) {
      throw new AssessmentError(400, 'Invalid subjectId')
    }
    const academicTermId = await resolveTermId(req.query.academicTermId as string)

    const ctx = await resolveAssessmentContext(sectionId, subjectId, academicTermId)

    const allowed = await isSubjectTeacherForSection(req.user!, ctx.section._id, subjectId)
    if (!allowed) {
      throw new AssessmentError(
        403,
        'Forbidden: You are not the subject teacher for this section'
      )
    }

    const { columns, students, conductedStageIds } = await buildSheet(
      ctx,
      academicTermId,
      toIdSet(ctx.conducted?.conductedStages),
      true
    )

    sendResponse(res, 200, true, 'Class sheet fetched successfully', {
      sectionId: String(ctx.section._id),
      subjectId,
      academicTermId,
      schoolYear: ctx.section.schoolYear,
      setup: { id: String(ctx.setup._id), name: ctx.setup.name },
      hasConductedStages: conductedStageIds.size > 0,
      columns,
      students,
    })
  } catch (error) {
    handleError(res, error)
  }
}

/**
 * GET /api/assessment/scores/results?sectionId=&subjectId=&academicTermId=
 *
 * Roles: admin, coordinator only. Read-only results view.
 *
 * Same shape as the class sheet, but marks are returned ONLY for locked stages.
 * Conducted-but-unlocked stages keep their state ("conducted") yet their cells
 * are { score: null, entered: false }, and total/average are computed from the
 * locked stages only (null when nothing is locked).
 */
export const getResultsSheet = async (req: AuthRequest, res: Response): Promise<void> => {
  const { sectionId, subjectId } = req.query as Record<string, string>
  try {
    if (!['admin', 'coordinator'].includes(req.user!.role)) {
      throw new AssessmentError(
        403,
        'Forbidden: Results are restricted to admins and coordinators'
      )
    }
    if (!mongoose.isValidObjectId(sectionId)) {
      throw new AssessmentError(400, 'Invalid sectionId')
    }
    if (!mongoose.isValidObjectId(subjectId)) {
      throw new AssessmentError(400, 'Invalid subjectId')
    }
    const academicTermId = await resolveTermId(req.query.academicTermId as string)

    const ctx = await resolveAssessmentContext(sectionId, subjectId, academicTermId)

    const { columns, students, conductedStageIds, lockedStageIds } = await buildSheet(
      ctx,
      academicTermId,
      toIdSet(ctx.conducted?.lockedStages),
      false
    )

    sendResponse(res, 200, true, 'Results fetched successfully', {
      sectionId: String(ctx.section._id),
      subjectId,
      academicTermId,
      schoolYear: ctx.section.schoolYear,
      setup: { id: String(ctx.setup._id), name: ctx.setup.name },
      hasConductedStages: conductedStageIds.size > 0,
      hasLockedStages: lockedStageIds.size > 0,
      columns,
      students,
    })
  } catch (error) {
    handleError(res, error)
  }
}

// ─── BATCH WRITE (offline-safe) ──────────────────────────────────────────────

/**
 * POST /api/assessment/scores/write
 * Body: { sectionId, subjectId, academicTermId, assessmentTypeId, records }
 *
 * Roles: admin, coordinator, subject teacher of the section+subject.
 */
export const writeScores = async (req: AuthRequest, res: Response): Promise<void> => {
  const { sectionId, subjectId, academicTermId, assessmentTypeId, records } = parseBody(req)
  try {
    if (!mongoose.isValidObjectId(sectionId)) throw new AssessmentError(400, 'Invalid sectionId')
    if (!mongoose.isValidObjectId(subjectId)) throw new AssessmentError(400, 'Invalid subjectId')
    const resolvedTermId = await resolveTermId(academicTermId)
    if (!mongoose.isValidObjectId(assessmentTypeId)) {
      throw new AssessmentError(400, 'Invalid assessmentTypeId')
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new AssessmentError(400, 'Body must contain a non-empty "records" array')
    }

    const allowed = await isSubjectTeacherForSection(req.user!, sectionId, subjectId)
    if (!allowed) {
      throw new AssessmentError(
        403,
        'Forbidden: You are not the subject teacher for this section'
      )
    }

    const { context, typeName, outcomes } = await writeStageScores(
      req,
      sectionId,
      subjectId,
      resolvedTermId,
      assessmentTypeId,
      records as StageSubmissionRecord[]
    )

    sendResponse(res, 200, true, 'Scores saved', {
      sectionId,
      subjectId,
      academicTermId: resolvedTermId,
      assessmentTypeId,
      typeName,
      state: stageState(context.conducted, assessmentTypeId),
      results: outcomes,
    })
  } catch (error) {
    handleError(res, error)
  }
}

// ─── STAGE ACTIONS ───────────────────────────────────────────────────────────

/**
 * POST /api/assessment/scores/conduct
 * Body: { sectionId, subjectId, academicTermId, assessmentTypeId }
 * Roles: admin, coordinator, subject teacher.
 */
export const conductStage = async (req: AuthRequest, res: Response): Promise<void> => {
  const { sectionId, subjectId, academicTermId, assessmentTypeId } = parseBody(req)
  try {
    if (!assessmentTypeId || !mongoose.isValidObjectId(assessmentTypeId)) {
      throw new AssessmentError(400, 'Invalid assessmentTypeId')
    }
    const resolvedTermId = await resolveTermId(academicTermId)
    const ctx = await resolveAssessmentContext(sectionId, subjectId, resolvedTermId, {
      createConducted: true,
      requireStarted: true,
    })
    const allowed = await isSubjectTeacherForSection(req.user!, ctx.section._id, subjectId)
    if (!allowed) {
      throw new AssessmentError(
        403,
        'Forbidden: You are not the subject teacher for this section'
      )
    }

    const type = ctx.typeById.get(assessmentTypeId)
    if (!type) throw new AssessmentError(400, 'Assessment type is not part of this setup')

    const conducted = ctx.conducted!
    const already = (conducted.conductedStages ?? []).some(
      (id: any) => String(id) === assessmentTypeId
    )
    if (!already) {
      const typeIndex = ctx.types.findIndex((t: any) => String(t._id) === assessmentTypeId)
      if (typeIndex > conducted.conductedStages.length) {
        const nextExpected = ctx.types[conducted.conductedStages.length]
        throw new AssessmentError(
          409,
          `Complete "${nextExpected.name}" before "${type.name}"`
        )
      }
      conducted.conductedStages.push(type._id)
      syncConductedStatus(conducted, ctx.types.length)
      await conducted.save()
      await recalcMarksheetsForSectionTerm(ctx.gsa._id, ctx.section._id, ctx.term._id)
    }

    const nextStage =
      ctx.types[(conducted.conductedStages ?? []).length]?.name ?? null

    sendResponse(res, 200, true, already ? 'Stage already conducted' : 'Stage marked conducted', {
      sectionId: String(ctx.section._id),
      subjectId,
      academicTermId: String(ctx.term._id),
      assessmentTypeId,
      typeName: type.name,
      state: stageState(conducted, assessmentTypeId),
      status: conducted.status,
      conductedStages: (conducted.conductedStages ?? []).map((id: any) => String(id)),
      lockedStages: (conducted.lockedStages ?? []).map((id: any) => String(id)),
      nextStage,
    })
  } catch (error) {
    handleError(res, error)
  }
}

/**
 * POST /api/assessment/scores/complete
 * Body: { sectionId, subjectId, academicTermId, assessmentTypeId }
 * Roles: admin, coordinator, subject teacher. Locks the stage's scores.
 */
export const completeStage = async (req: AuthRequest, res: Response): Promise<void> => {
  const { sectionId, subjectId, academicTermId, assessmentTypeId } = parseBody(req)
  try {
    if (!assessmentTypeId || !mongoose.isValidObjectId(assessmentTypeId)) {
      throw new AssessmentError(400, 'Invalid assessmentTypeId')
    }
    const resolvedTermId = await resolveTermId(academicTermId)
    const ctx = await resolveAssessmentContext(sectionId, subjectId, resolvedTermId, {
      requireStarted: true,
    })
    const allowed = await isSubjectTeacherForSection(req.user!, ctx.section._id, subjectId)
    if (!allowed) {
      throw new AssessmentError(
        403,
        'Forbidden: You are not the subject teacher for this section'
      )
    }
    const type = ctx.typeById.get(assessmentTypeId)
    if (!type) throw new AssessmentError(400, 'Assessment type is not part of this setup')
    if (!ctx.conducted) {
      throw new AssessmentError(409, 'Stage must be conducted before it can be completed')
    }

    const conducted = ctx.conducted
    const isConducted = (conducted.conductedStages ?? []).some(
      (id: any) => String(id) === assessmentTypeId
    )
    if (!isConducted) {
      throw new AssessmentError(409, 'Stage must be conducted before it can be completed')
    }

    const alreadyLocked = (conducted.lockedStages ?? []).some(
      (id: any) => String(id) === assessmentTypeId
    )
    if (!alreadyLocked) {
      conducted.lockedStages.push(type._id)
      syncConductedStatus(conducted, ctx.types.length)
      await conducted.save()
    }

    sendResponse(res, 200, true, alreadyLocked ? 'Stage already locked' : 'Stage completed and locked', {
      sectionId: String(ctx.section._id),
      subjectId,
      academicTermId: String(ctx.term._id),
      assessmentTypeId,
      typeName: type.name,
      state: stageState(conducted, assessmentTypeId),
      status: conducted.status,
      conductedStages: (conducted.conductedStages ?? []).map((id: any) => String(id)),
      lockedStages: (conducted.lockedStages ?? []).map((id: any) => String(id)),
    })
  } catch (error) {
    handleError(res, error)
  }
}

/**
 * POST /api/assessment/scores/reopen
 * Body: { sectionId, subjectId, academicTermId, assessmentTypeId }
 * Roles: admin, coordinator only. Unlocks a locked stage without un-conducting it.
 */
export const reopenStage = async (req: AuthRequest, res: Response): Promise<void> => {
  const { sectionId, subjectId, academicTermId, assessmentTypeId } = parseBody(req)
  try {
    if (!assessmentTypeId || !mongoose.isValidObjectId(assessmentTypeId)) {
      throw new AssessmentError(400, 'Invalid assessmentTypeId')
    }
    const resolvedTermId = await resolveTermId(academicTermId)
    const ctx = await resolveAssessmentContext(sectionId, subjectId, resolvedTermId, {
      requireStarted: true,
    })
    const allowed = await isSubjectTeacherForSection(req.user!, ctx.section._id, subjectId)
    if (!allowed) {
      throw new AssessmentError(
        403,
        'Forbidden: You are not the subject teacher for this section'
      )
    }
    const type = ctx.typeById.get(assessmentTypeId)
    if (!type) throw new AssessmentError(400, 'Assessment type is not part of this setup')
    if (!ctx.conducted) {
      throw new AssessmentError(409, 'Stage is not conducted for this section and term')
    }

    const conducted = ctx.conducted
    const isConducted = (conducted.conductedStages ?? []).some(
      (id: any) => String(id) === assessmentTypeId
    )
    if (!isConducted) {
      throw new AssessmentError(409, 'Stage is not conducted for this section and term')
    }

    conducted.lockedStages = (conducted.lockedStages ?? []).filter(
      (id: any) => String(id) !== assessmentTypeId
    )
    syncConductedStatus(conducted, ctx.types.length)
    await conducted.save()

    await recalcMarksheetsForSectionTerm(ctx.gsa._id, ctx.section._id, ctx.term._id)

    await logAudit(req, {
      type: 'ASSESSMENT_STAGE_REOPEN',
      message: `Reopened ${type.name} for section ${ctx.section.name} in ${ctx.subjectName} (${ctx.term.name})`,
      action: 'reopened',
      entity: 'ConductedAssessment',
      target: String(conducted._id),
    })

    sendResponse(res, 200, true, 'Stage reopened', {
      sectionId: String(ctx.section._id),
      subjectId,
      academicTermId: String(ctx.term._id),
      assessmentTypeId,
      typeName: type.name,
      state: stageState(conducted, assessmentTypeId),
      status: conducted.status,
      conductedStages: (conducted.conductedStages ?? []).map((id: any) => String(id)),
      lockedStages: (conducted.lockedStages ?? []).map((id: any) => String(id)),
    })
  } catch (error) {
    handleError(res, error)
  }
}

// ─── READ / SINGLE EDIT / DELETE ─────────────────────────────────────────────

/**
 * GET /api/assessment/scores/:id
 * Roles: admin, coordinator, subject teacher, parent of the student.
 */
export const getAssessmentScoreById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params
  try {
    if (!mongoose.isValidObjectId(id)) throw new AssessmentError(400, 'Invalid marksheet id')
    const score = await AssessmentScore.findById(id)
      .populate('studentId', 'firstName middleName lastName')
      .populate('sectionId', 'name schoolYear')
      .populate('academicTermId', 'name')
    if (!score) throw new AssessmentError(404, 'Marksheet not found')

    const user = req.user!
    let fullAccess = false
    if (['admin', 'coordinator'].includes(user.role)) {
      // Managers are restricted to the locked-only view (below).
      fullAccess = false
    } else if (user.role === 'parent') {
      const { Student } = await import('../../models/student.model.js')
      const studentRef = (score.studentId as any)?._id ?? score.studentId
      const student = await Student.findById(studentRef).select('parentId').lean()
      if (!student || !student.parentId || String(student.parentId) !== String(user.id)) {
        throw new AssessmentError(403, 'Forbidden: Not your child\'s marksheet')
      }
      fullAccess = false
    } else if (user.role === 'teacher') {
      const gsa = await findGsaSubject(score.gsaId)
      if (!gsa) throw new AssessmentError(404, 'Associated grade-subject assessment not found')
      const allowed = await isSubjectTeacherForSection(
        user,
        refId(score.sectionId),
        gsa.subjectId
      )
      if (!allowed) {
        throw new AssessmentError(403, 'Forbidden: You are not the subject teacher for this section')
      }
      fullAccess = true
    } else {
      throw new AssessmentError(403, 'Access denied')
    }

    if (fullAccess) {
      sendResponse(res, 200, true, 'Marksheet fetched successfully', score)
      return
    }

    // Admin, coordinator and parent only ever see locked stages (and totals
    // computed from them); unlocked marks are stripped before the response.
    const { lockedStageIds, typeWeightById } = await loadLockedVisibility(
      refId(score.gsaId),
      refId(score.sectionId),
      refId(score.academicTermId)
    )
    sendResponse(
      res,
      200,
      true,
      'Marksheet fetched successfully',
      restrictToLockedStages(score, lockedStageIds, typeWeightById)
    )
  } catch (error) {
    handleError(res, error)
  }
}

/**
 * PUT /api/assessment/scores/:id
 * Body: { assessmentTypeId, score, expectedUpdatedAt? }
 * Roles: admin, coordinator, subject teacher. Goes through the batch writer.
 */
export const updateAssessmentScore = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params
  try {
    if (!mongoose.isValidObjectId(id)) throw new AssessmentError(400, 'Invalid marksheet id')
    const { assessmentTypeId, score, expectedUpdatedAt } = req.body ?? {}
    if (!assessmentTypeId || !mongoose.isValidObjectId(assessmentTypeId)) {
      throw new AssessmentError(400, 'Invalid assessmentTypeId')
    }

    const doc = await AssessmentScore.findById(id).select(
      'studentId gsaId sectionId academicTermId'
    )
    if (!doc) throw new AssessmentError(404, 'Marksheet not found')

    const gsa = await findGsaSubject(doc.gsaId)
    if (!gsa) throw new AssessmentError(404, 'Associated grade-subject assessment not found')

    const allowed = await isSubjectTeacherForSection(req.user!, doc.sectionId, gsa.subjectId)
    if (!allowed) {
      throw new AssessmentError(403, 'Forbidden: You are not the subject teacher for this section')
    }

    // Score validation (against the type's weight) happens in the writer so a
    // single PUT and a batch write share exactly the same rules.
    const { outcomes } = await writeStageScores(
      req,
      String(doc.sectionId),
      String(gsa.subjectId),
      String(doc.academicTermId),
      String(assessmentTypeId),
      [
        {
          studentId: String(doc.studentId),
          score,
          expectedUpdatedAt:
            expectedUpdatedAt === undefined ? undefined : expectedUpdatedAt,
        },
      ]
    )

    const outcome = outcomes[0]
    const status = outcome.action === 'conflict' ? 409 : outcome.action === 'rejected' ? 400 : 200
    sendResponse(res, status, status === 200, `Score ${outcome.action}`, outcome)
  } catch (error) {
    handleError(res, error)
  }
}

/**
 * DELETE /api/assessment/scores/:id
 * Roles: admin, coordinator, subject teacher. Blocked when a stage is locked.
 */
export const deleteAssessmentScore = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params
  try {
    if (!mongoose.isValidObjectId(id)) throw new AssessmentError(400, 'Invalid marksheet id')
    const doc = await AssessmentScore.findById(id)
    if (!doc) throw new AssessmentError(404, 'Marksheet not found')

    const gsa = await findGsaSubject(doc.gsaId)
    if (!gsa) throw new AssessmentError(404, 'Associated grade-subject assessment not found')

    if (!mongoose.isValidObjectId(doc.academicTermId)) {
      throw new AssessmentError(400, 'Marksheet has no valid academic term')
    }
    const ctx = await resolveAssessmentContext(
      String(doc.sectionId),
      String(gsa.subjectId),
      String(doc.academicTermId),
      { requireStarted: true }
    )

    const allowed = await isSubjectTeacherForSection(req.user!, doc.sectionId, gsa.subjectId)
    if (!allowed) {
      throw new AssessmentError(403, 'Forbidden: You are not the subject teacher for this section')
    }

    const conducted = await ConductedAssessment.findOne({
      gsaId: doc.gsaId,
      sectionId: doc.sectionId,
      academicTermId: doc.academicTermId,
    }).lean()
    const lockedIds = new Set<string>(
      (conducted?.lockedStages ?? []).map((sid: any) => String(sid))
    )
    const touchesLocked = (doc.scores ?? []).some((s: any) =>
      lockedIds.has(String(s.assessmentTypeId))
    )
    if (touchesLocked) {
      throw new AssessmentError(
        409,
        'Cannot delete this marksheet because it contains scores for a locked stage'
      )
    }

    const student = await Student.findById(doc.studentId)
      .select('firstName middleName lastName')
      .lean()
    const studentName =
      [student?.firstName, student?.middleName, student?.lastName]
        .filter(Boolean)
        .join(' ') || 'Unknown student'

    await AssessmentScore.findByIdAndDelete(id)
    await logAudit(req, {
      type: 'ASSESSMENT_SCORE_WRITE',
      message: `Deleted marksheet for ${studentName} in section ${ctx.section.name} for ${ctx.subjectName} (${ctx.term.name})`,
      action: 'deleted',
      entity: 'AssessmentScore',
      target: String(doc._id),
    })

    sendResponse(res, 200, true, 'Marksheet deleted')
  } catch (error) {
    handleError(res, error)
  }
}
