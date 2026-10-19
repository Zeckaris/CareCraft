/**
 * assessmentScore.service.ts
 *
 * Shared logic for the section + term + subject assessment flow:
 *   - resolving/validating the (section, subject, term) context
 *   - the offline-safe batch score writer (plan, then write, never abort)
 *   - result recalculation (totals/average) for one marksheet or many
 *
 * The writer mirrors the attendance take endpoint: a plan pass decides every
 * record against DB state, then a write pass commits only the planned records,
 * each in its own try/catch, with duplicate-key races re-decided.
 */

import mongoose, { Types } from 'mongoose'
import { Request } from 'express'
import { AssessmentScore } from '../models/assessment/assessmentScore.model.js'
import { GradeSubjectAssessment } from '../models/gradeSubjectAssessment.model.js'
import { AssessmentSetup } from '../models/assessment/assessmentSetup.model.js'
import { ConductedAssessment } from '../models/ConductedAssessment.model.js'
import { AcademicTerm } from '../models/academicTerm.model.js'
import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { Section } from '../models/section.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import { computeTotals, deriveStatus } from '../utils/assessment.utility.js'
import { yearsMatch } from '../utils/yearNormalizer.js'
import {
  getSchoolTimezone,
  toSchoolDateString,
  todaySchoolDate,
} from '../utils/schoolDate.util.js'
import { logAudit } from '../utils/auditLogger.util.js'

// ─── errors ──────────────────────────────────────────────────────────────────

/** An error whose message and status are safe to return to the client. */
export class AssessmentError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AssessmentError'
    this.status = status
  }
}

// ─── context ─────────────────────────────────────────────────────────────────

export interface AssessmentContext {
  section: any
  gsa: any
  setup: any
  types: any[]
  typeById: Map<string, any>
  typeWeightById: Map<string, number>
  term: any
  conducted: any | null
}

function assertObjectId(value: unknown, label: string): asserts value is string {
  if (!value || !mongoose.isValidObjectId(value as string)) {
    throw new AssessmentError(400, `Invalid ${label}`)
  }
}

/**
 * Resolves and validates a section + subject + term context.
 *
 * Throws AssessmentError (404/400) when the section, GSA, setup or term is
 * missing, or when the term's academic year disagrees with the section's.
 */
export async function resolveAssessmentContext(
  sectionId: string,
  subjectId: string,
  academicTermId: string,
  options: { createConducted?: boolean; create?: boolean; requireStarted?: boolean } = {}
): Promise<AssessmentContext> {
  assertObjectId(sectionId, 'sectionId')
  assertObjectId(subjectId, 'subjectId')
  assertObjectId(academicTermId, 'academicTermId')

  const section = await Section.findById(sectionId).lean()
  if (!section) throw new AssessmentError(404, 'Section not found')

  const gsa = await GradeSubjectAssessment.findOne({
    gradeId: section.gradeId,
    subjectId,
  })
  if (!gsa) {
    throw new AssessmentError(
      404,
      'No assessment setup is assigned for this subject and grade'
    )
  }

  const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate(
    'assessmentTypeIds'
  )
  if (!setup) throw new AssessmentError(404, 'Assessment setup not found')

  const term = await AcademicTerm.findById(academicTermId).lean()
  if (!term) throw new AssessmentError(404, 'Academic term not found')

  const calendar = await AcademicCalendar.findById(term.calendarId).lean()
  if (!calendar) {
    throw new AssessmentError(
      409,
      `Academic calendar for term "${term.name}" was not found`
    )
  }
  if (!yearsMatch(calendar.academicYear, section.schoolYear)) {
    throw new AssessmentError(
      409,
      `Term "${term.name}" belongs to ${calendar.academicYear}, but this section is for ${section.schoolYear}`
    )
  }

  if (options.requireStarted) {
    const timeZone = await getSchoolTimezone()
    const today = todaySchoolDate(timeZone)
    const startDate = toSchoolDateString(term.startDate, timeZone)
    if (!startDate) {
      throw new AssessmentError(
        409,
        `Academic term "${term.name}" has no valid start date`
      )
    }
    if (today < startDate) {
      throw new AssessmentError(
        409,
        `Academic term "${term.name}" has not started yet (starts ${startDate})`
      )
    }
  }

  const types = ((setup.assessmentTypeIds ?? []) as any[]).filter(
    (t) => t && typeof t === 'object' && t._id
  )
  const typeById = new Map(types.map((t) => [String(t._id), t]))
  const typeWeightById = new Map(
    types.map((t) => [String(t._id), Number(t.weight) || 0])
  )

  let conducted = await ConductedAssessment.findOne({
    gsaId: gsa._id,
    academicTermId,
    sectionId,
  })

  if (!conducted && options.createConducted) {
    try {
      conducted = await ConductedAssessment.create({
        gsaId: gsa._id,
        academicTermId,
        sectionId,
        conductedStages: [],
        lockedStages: [],
        status: 'planned',
      })
    } catch (err: any) {
      if (err?.code !== 11000) throw err
      conducted = await ConductedAssessment.findOne({
        gsaId: gsa._id,
        academicTermId,
        sectionId,
      })
    }
  }

  return {
    section,
    gsa,
    setup,
    types,
    typeById,
    typeWeightById,
    term,
    conducted,
  }
}

/** True when the user is the subject teacher for the section, or an admin/coordinator. */
export async function isSubjectTeacherForSection(
  user: { id: Types.ObjectId | string; role: string },
  sectionId: Types.ObjectId | string,
  subjectId: Types.ObjectId | string
): Promise<boolean> {
  if (['admin', 'coordinator'].includes(user.role)) return true
  if (user.role !== 'teacher') return false
  const assignment = await TeachingAssignment.findOne({
    teacherId: user.id,
    sectionId,
    role: 'subject',
    subjectId,
  }).lean()
  return !!assignment
}

// ─── offline-safe batch writer ───────────────────────────────────────────────

export interface StageSubmissionRecord {
  studentId: string
  score: number
  /**
   * Optimistic-concurrency token, as in attendance:
   *   absent (undefined) -> no expectation, last write wins
   *   null               -> client believes NO marksheet exists
   *   ISO string         -> must equal the stored marksheet's updatedAt
   */
  expectedUpdatedAt?: string | null
}

export type ScoreAction =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'skipped'
  | 'conflict'
  | 'rejected'

export interface ScoreOutcome {
  studentId: string
  action: ScoreAction
  reason?: string
  /** Only on created/updated/unchanged. */
  score?: number
  /** Only on created/updated: the marksheet's updatedAt after the write. */
  updatedAt?: string | null
  /** Only on conflicts: the currently stored value for this stage. */
  stored?: { score: number | null; updatedAt: string | null } | null
  /** The student's marksheet total after this request (null when unknown/none). */
  total?: number | null
  /** The student's marksheet average after this request (null when unknown/none). */
  average?: number | null
}

interface ExistingScoreLike {
  _id: Types.ObjectId
  scores: any[]
  total?: number | null
  average?: number | null
  updatedAt?: Date
}

interface PlannedWrite {
  index: number
  record: StageSubmissionRecord
  kind: 'create' | 'update'
  existing: ExistingScoreLike | null
}

type Decision =
  | { type: 'conflict'; reason: string }
  | { type: 'unchanged' }
  | { type: 'update' }
  | { type: 'create' }

const findEntry = (doc: ExistingScoreLike, assessmentTypeId: string) =>
  doc.scores.find((s: any) => String(s.assessmentTypeId) === assessmentTypeId)

/**
 * Pure decision for a submitted record that has a stored marksheet.
 */
function decideAgainstExisting(
  record: StageSubmissionRecord,
  existing: ExistingScoreLike,
  assessmentTypeId: string
): Decision {
  if (record.expectedUpdatedAt !== undefined) {
    if (record.expectedUpdatedAt === null) {
      return {
        type: 'conflict',
        reason: 'A marksheet already exists but the client expected none',
      }
    }
    const expected = new Date(record.expectedUpdatedAt)
    const actual = existing.updatedAt ? new Date(existing.updatedAt).getTime() : null
    if (
      Number.isNaN(expected.getTime()) ||
      actual === null ||
      expected.getTime() !== actual
    ) {
      return {
        type: 'conflict',
        reason:
          'expectedUpdatedAt does not match the stored marksheet; it was changed elsewhere',
      }
    }
  }

  const entry = findEntry(existing, assessmentTypeId)
  if (entry && Number(entry.score) === record.score) {
    return { type: 'unchanged' }
  }
  return { type: 'update' }
}

function storedOutcome(
  record: StageSubmissionRecord,
  existing: ExistingScoreLike,
  assessmentTypeId: string,
  reason: string
): ScoreOutcome {
  const entry = findEntry(existing, assessmentTypeId)
  return {
    studentId: String(record.studentId),
    action: 'conflict',
    reason,
    stored: {
      score: entry ? Number(entry.score) : null,
      updatedAt: existing.updatedAt ? new Date(existing.updatedAt).toISOString() : null,
    },
    total: existing.total ?? null,
    average: existing.average ?? null,
  }
}

/**
 * Plans and writes scores for one stage (section + subject + term + type).
 * Requires the stage to be conducted and not locked (enforced by the caller
 * via assertStageWritable, but re-checked here for safety).
 */
export async function writeStageScores(
  req: Request,
  sectionId: string,
  subjectId: string,
  academicTermId: string,
  assessmentTypeId: string,
  records: StageSubmissionRecord[]
): Promise<{ context: AssessmentContext; typeName: string; outcomes: ScoreOutcome[] }> {
  assertObjectId(assessmentTypeId, 'assessmentTypeId')

  const context = await resolveAssessmentContext(sectionId, subjectId, academicTermId, {
    requireStarted: true,
  })
  const { gsa, setup, typeById, typeWeightById, section, term, conducted } = context

  const type = typeById.get(assessmentTypeId)
  if (!type) {
    throw new AssessmentError(400, 'Assessment type is not part of this setup')
  }
  // A mark is valid from 0 up to this type's weight (the weight is its max mark).
  const maxMark = typeWeightById.get(assessmentTypeId) ?? 0
  if (!conducted) {
    throw new AssessmentError(
      409,
      `Stage "${type.name}" has not been conducted for this section and term`
    )
  }
  const conductedStageIds = new Set<string>(
    (conducted.conductedStages ?? []).map((id: any) => String(id))
  )
  if (!conductedStageIds.has(assessmentTypeId)) {
    throw new AssessmentError(
      409,
      `Stage "${type.name}" has not been conducted for this section and term`
    )
  }
  const lockedStageIds = new Set<string>(
    (conducted.lockedStages ?? []).map((id: any) => String(id))
  )
  if (lockedStageIds.has(assessmentTypeId)) {
    throw new AssessmentError(
      409,
      `Stage "${type.name}" is locked; an administrator must reopen it before scores can change`
    )
  }

  // Active students in this section only.
  const enrollments = await StudentEnrollment.find({
    sectionId: section._id,
    isActive: true,
  })
    .select('studentId')
    .lean()
  const activeStudentIds = new Set(enrollments.map((e: any) => String(e.studentId)))

  // Deduplicate: only the first record per student is processed.
  const seen = new Set<string>()
  const outcomes: ScoreOutcome[] = new Array(records.length)
  const planned: PlannedWrite[] = []

  const submittedIds = records
    .map((r) => String(r.studentId))
    .filter((id) => mongoose.isValidObjectId(id))

  const existingDocs =
    submittedIds.length > 0
      ? await AssessmentScore.find({
          gsaId: gsa._id,
          sectionId: section._id,
          academicTermId,
          studentId: { $in: submittedIds },
        })
      : []
  const existingByStudent = new Map<string, ExistingScoreLike>()
  for (const doc of existingDocs) {
    existingByStudent.set(String(doc.studentId), doc as unknown as ExistingScoreLike)
  }

  // The student's current totals, for outcomes that do not change the marksheet.
  const totalsFor = (sid: string): { total: number | null; average: number | null } => {
    const doc = existingByStudent.get(sid)
    return { total: doc?.total ?? null, average: doc?.average ?? null }
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    const sid = String(record.studentId)

    if (!mongoose.isValidObjectId(sid)) {
      outcomes[i] = {
        studentId: sid,
        action: 'rejected',
        reason: 'Invalid studentId',
        ...totalsFor(sid),
      }
      continue
    }
    if (seen.has(sid)) {
      outcomes[i] = {
        studentId: sid,
        action: 'skipped',
        reason: 'Duplicate student in submission',
        ...totalsFor(sid),
      }
      continue
    }
    seen.add(sid)

    if (
      typeof record.score !== 'number' ||
      Number.isNaN(record.score) ||
      record.score < 0 ||
      record.score > maxMark
    ) {
      outcomes[i] = {
        studentId: sid,
        action: 'rejected',
        reason: `score must be a number between 0 and ${maxMark}`,
        ...totalsFor(sid),
      }
      continue
    }
    if (!activeStudentIds.has(sid)) {
      outcomes[i] = {
        studentId: sid,
        action: 'skipped',
        reason: 'Student is not actively enrolled in this section',
        ...totalsFor(sid),
      }
      continue
    }

    const existing = existingByStudent.get(sid) ?? null
    if (existing) {
      const decision = decideAgainstExisting(record, existing, assessmentTypeId)
      if (decision.type === 'conflict') {
        outcomes[i] = storedOutcome(record, existing, assessmentTypeId, decision.reason)
        continue
      }
      if (decision.type === 'unchanged') {
        outcomes[i] = {
          studentId: sid,
          action: 'unchanged',
          score: record.score,
          total: existing.total ?? null,
          average: existing.average ?? null,
        }
        continue
      }
      planned.push({ index: i, record, kind: 'update', existing })
    } else {
      if (typeof record.expectedUpdatedAt === 'string') {
        outcomes[i] = {
          studentId: sid,
          action: 'conflict',
          reason: 'No marksheet exists but a non-null expectedUpdatedAt was provided',
          stored: null,
          total: null,
          average: null,
        }
        continue
      }
      planned.push({ index: i, record, kind: 'create', existing: null })
    }
  }

  // ── Write phase ──────────────────────────────────────────────────────────

  const buildPruned = (baseScores: any[], score: number): any[] => {
    const next = baseScores.filter((s: any) => typeById.has(String(s.assessmentTypeId)))
    const withoutStage = next.filter(
      (s: any) => String(s.assessmentTypeId) !== assessmentTypeId
    )
    withoutStage.push({
      assessmentTypeId: new Types.ObjectId(assessmentTypeId),
      score,
    })
    return withoutStage
  }

  const commitCreate = async (pw: PlannedWrite): Promise<ScoreOutcome> => {
    const rec = pw.record
    const sid = String(rec.studentId)
    const scores = [
      { assessmentTypeId: new Types.ObjectId(assessmentTypeId), score: rec.score },
    ]
    const totals = computeTotals(scores, typeWeightById, conductedStageIds)
    try {
      const doc = await AssessmentScore.create({
        studentId: new Types.ObjectId(sid),
        gsaId: gsa._id,
        sectionId: section._id,
        academicTermId: term._id,
        schoolYear: section.schoolYear,
        scores,
        total: totals.total,
        average: totals.average,
      })
      await logAudit(req, {
        type: 'ASSESSMENT_SCORE_WRITE',
        message: `Recorded ${type.name} score ${rec.score} for student ${sid} in section ${String(
          section._id
        )} (${section.schoolYear})`,
        action: 'recorded',
        entity: 'AssessmentScore',
        target: String(doc._id),
      })
      return {
        studentId: sid,
        action: 'created',
        score: rec.score,
        updatedAt: (doc as any).updatedAt
          ? new Date((doc as any).updatedAt).toISOString()
          : null,
        total: totals.total,
        average: totals.average,
      }
    } catch (err: any) {
      if (err?.code !== 11000) {
        return {
          studentId: sid,
          action: 'rejected',
          reason: `Server error while saving record: ${err?.message ?? 'unknown error'}`,
          ...totalsFor(sid),
        }
      }
      // Race: another writer created it first.
      const raced = await AssessmentScore.findOne({
        studentId: sid,
        gsaId: gsa._id,
        sectionId: section._id,
        academicTermId,
      })
      if (!raced) return commitCreate(pw)
      return commitUpdateDecision(rec, raced as unknown as ExistingScoreLike)
    }
  }

  const commitUpdateDecision = async (
    rec: StageSubmissionRecord,
    existing: ExistingScoreLike
  ): Promise<ScoreOutcome> => {
    const sid = String(rec.studentId)
    const decision = decideAgainstExisting(rec, existing, assessmentTypeId)
    if (decision.type === 'conflict') {
      return storedOutcome(rec, existing, assessmentTypeId, decision.reason)
    }
    if (decision.type === 'unchanged') {
      return {
        studentId: sid,
        action: 'unchanged',
        score: rec.score,
        total: existing.total ?? null,
        average: existing.average ?? null,
      }
    }

    const scores = buildPruned(existing.scores, rec.score)
    const totals = computeTotals(scores, typeWeightById, conductedStageIds)

    const filter: any = { _id: existing._id }
    if (typeof rec.expectedUpdatedAt === 'string') {
      filter.updatedAt = new Date(rec.expectedUpdatedAt)
    }

    const updated = await AssessmentScore.findOneAndUpdate(
      filter,
      { $set: { scores, total: totals.total, average: totals.average } },
      { new: true }
    )

    if (!updated) {
      // Deleted under us (or version mismatch slipped through) – re-fetch and redecide.
      const raced = await AssessmentScore.findOne({
        studentId: sid,
        gsaId: gsa._id,
        sectionId: section._id,
        academicTermId,
      })
      if (!raced) return commitCreate({ index: 0, record: rec, kind: 'create', existing: null })
      return commitUpdateDecision(rec, raced as unknown as ExistingScoreLike)
    }

    await logAudit(req, {
      type: 'ASSESSMENT_SCORE_WRITE',
      message: `Updated ${type.name} score to ${rec.score} for student ${sid} in section ${String(
        section._id
      )}`,
      action: 'corrected',
      entity: 'AssessmentScore',
      target: String(existing._id),
    })

    return {
      studentId: sid,
      action: 'updated',
      score: rec.score,
      updatedAt: (updated as any).updatedAt
        ? new Date((updated as any).updatedAt).toISOString()
        : null,
      total: totals.total,
      average: totals.average,
    }
  }

  for (const pw of planned) {
    const sid = String(pw.record.studentId)
    try {
      if (pw.kind === 'create') {
        outcomes[pw.index] = await commitCreate(pw)
      } else {
        outcomes[pw.index] = await commitUpdateDecision(pw.record, pw.existing!)
      }
    } catch (err: any) {
      outcomes[pw.index] = {
        studentId: sid,
        action: 'rejected',
        reason: `Server error while saving record: ${err?.message ?? 'unknown error'}`,
        ...totalsFor(sid),
      }
    }
  }

  return { context, typeName: type.name, outcomes }
}

// ─── recalculation ───────────────────────────────────────────────────────────

/**
 * Recomputes total/average (and prunes stale type entries) for every marksheet
 * in one GSA + section + term group. Returns the number of marksheets changed.
 */
async function recalcGroup(
  gsaId: Types.ObjectId,
  setup: any,
  sectionId: string | Types.ObjectId,
  academicTermId: string | Types.ObjectId
): Promise<number> {
  const types = ((setup.assessmentTypeIds ?? []) as any[]).filter(
    (t) => t && typeof t === 'object' && t._id
  )
  const typeById = new Map(types.map((t) => [String(t._id), t]))
  const typeWeightById = new Map(
    types.map((t) => [String(t._id), Number(t.weight) || 0])
  )

  const conducted = await ConductedAssessment.findOne({
    gsaId,
    sectionId,
    academicTermId,
  })
  const conductedStageIds = new Set<string>(
    (conducted?.conductedStages ?? []).map((id: any) => String(id))
  )

  const docs = await AssessmentScore.find({ gsaId, sectionId, academicTermId })
  let changed = 0
  for (const doc of docs) {
    const pruned = (doc.scores as any[]).filter((s) =>
      typeById.has(String(s.assessmentTypeId))
    )
    const totals = computeTotals(pruned, typeWeightById, conductedStageIds)
    const isChanged =
      pruned.length !== doc.scores.length ||
      doc.total !== totals.total ||
      doc.average !== totals.average
    if (isChanged) {
      doc.scores = pruned as any
      doc.total = totals.total
      doc.average = totals.average
      await doc.save()
      changed++
    }
  }
  return changed
}

/**
 * Recomputes every marksheet belonging to a GSA (all sections and terms).
 */
export async function recalcMarksheetsForGsa(
  gsaId: Types.ObjectId | string
): Promise<number> {
  const gsa = await GradeSubjectAssessment.findById(gsaId).lean()
  if (!gsa) return 0
  const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate(
    'assessmentTypeIds'
  )
  if (!setup) return 0

  const groups = await AssessmentScore.aggregate([
    { $match: { gsaId: new Types.ObjectId(String(gsaId)) } },
    { $group: { _id: { sectionId: '$sectionId', academicTermId: '$academicTermId' } } },
  ])

  let changed = 0
  for (const g of groups) {
    changed += await recalcGroup(
      gsa._id as Types.ObjectId,
      setup,
      g._id.sectionId,
      g._id.academicTermId
    )
  }
  return changed
}

/** Recomputes marksheets for one GSA + section + term (used after stage changes). */
export async function recalcMarksheetsForSectionTerm(
  gsaId: Types.ObjectId | string,
  sectionId: Types.ObjectId | string,
  academicTermId: Types.ObjectId | string
): Promise<number> {
  const gsa = await GradeSubjectAssessment.findById(gsaId).lean()
  if (!gsa) return 0
  const setup = await AssessmentSetup.findById(gsa.assessmentSetupId).populate(
    'assessmentTypeIds'
  )
  if (!setup) return 0
  return recalcGroup(new Types.ObjectId(String(gsaId)), setup, sectionId, academicTermId)
}

/** Recomputes marksheets for every GSA that uses any of the given setups. */
export async function recalcMarksheetsForSetups(
  setupIds: Array<Types.ObjectId | string>
): Promise<number> {
  if (setupIds.length === 0) return 0
  const gsas = await GradeSubjectAssessment.find({
    assessmentSetupId: { $in: setupIds },
  })
    .select('_id')
    .lean()
  let changed = 0
  for (const gsa of gsas) {
    changed += await recalcMarksheetsForGsa(gsa._id as Types.ObjectId)
  }
  return changed
}

/** Recomputes marksheets for every setup that contains the given assessment type. */
export async function recalcMarksheetsForAssessmentType(
  assessmentTypeId: Types.ObjectId | string
): Promise<number> {
  const setups = await AssessmentSetup.find({ assessmentTypeIds: assessmentTypeId })
    .select('_id')
    .lean()
  return recalcMarksheetsForSetups(setups.map((s) => s._id as Types.ObjectId))
}

/** Derives and persists the conducted-assessment status from its stage lists. */
export function syncConductedStatus(conducted: any, totalTypes: number): void {
  conducted.status = deriveStatus(
    (conducted.conductedStages ?? []).length,
    totalTypes
  )
}
