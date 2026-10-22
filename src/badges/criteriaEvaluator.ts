import { Types } from 'mongoose'
import { AcademicTerm } from '../models/academicTerm.model.js'
import { AssessmentScore } from '../models/assessment/assessmentScore.model.js'
import { Attendance } from '../models/attendance.model.js'
import { AttributeEvaluation } from '../models/attributeEvaluation.model.js'
import { ConductedAssessment } from '../models/ConductedAssessment.model.js'
import { GradeSubjectAssessment } from '../models/gradeSubjectAssessment.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { classPerformanceBasePipeline } from '../service/lockedStagePerformance.service.js'
import { calculateAttendanceRate } from '../utils/attendanceRate.util.js'
import {
  addDaysSchoolDate,
  normalizeSchoolDateInput,
  toSchoolDateString,
} from '../utils/schoolDate.util.js'
import { getYearVariants } from '../utils/yearNormalizer.js'
import type {
  BadgeCriteriaScope,
  BadgeCriteriaType,
  BadgeStreakMode,
} from './criteriaRegistry.js'

export type CriterionUnit = 'score' | 'percent' | 'points' | 'days' | 'manual'

export interface CriterionResult {
  criterionId: string
  type: BadgeCriteriaType
  scope: BadgeCriteriaScope | null
  current: number | null
  target: number | null
  unit: CriterionUnit
  enoughData: boolean
  met: boolean
  /** True only for criteria that cannot be evaluated in the current window. */
  notApplicable?: boolean
  /** True while at least one relevant assessment stage is still unlocked. */
  waitingForAssessments?: boolean
  /** Share of relevant assessment stages that are locked, 0 to 100. */
  lockedShare?: number | null
  details: Record<string, any>
}

export interface BadgeEvaluationResult {
  criteria: CriterionResult[]
  allMet: boolean
}

interface ContextSubject {
  gsaId: string
  subjectId: string
  subjectName: string
  setupStages: Array<{ id: string; weight: number }>
}

export interface BadgeEvaluationContext {
  studentId: string
  term: any
  termId: string
  schoolYear: string
  timeZone: string
  enrollment: any
  terms: any[]
  attributeEvaluations: any[]
  attendanceRows: any[]
  academicRows: any[]
  subjects: ContextSubject[]
  /** Key is `${termId}:${gsaId}`, value is the set of locked stage ids. */
  lockedStagesByTermAndGsa: Map<string, Set<string>>
}

interface TermBounds {
  startDate: Date | null
  endExclusive: Date | null
  startString: string | null
  endString: string | null
}

interface SubjectLockProgress {
  subjectId: string
  subjectName: string
  requiredStageCount: number
  lockedStageCount: number
  fullyLocked: boolean
}

interface TermLockProgress {
  termId: string
  requiredStageCount: number
  lockedStageCount: number
}

interface LockStatus {
  applicable: boolean
  fullyLocked: boolean
  requiredStageCount: number
  lockedStageCount: number
  lockedShare: number
  lockedWeightPercentage: number
  subjects: SubjectLockProgress[]
  terms: TermLockProgress[]
}

const EMPTY_LOCKED_STAGES = new Set<string>()

const round2 = (value: number): number => Math.round(value * 100) / 100

function termBounds(term: any, timeZone: string): TermBounds {
  const startString = toSchoolDateString(term?.startDate, timeZone)
  const endString = toSchoolDateString(term?.endDate, timeZone)
  const nextDay = endString ? addDaysSchoolDate(endString, 1) : null
  return {
    startString,
    endString,
    startDate: startString
      ? normalizeSchoolDateInput(startString, timeZone)
      : null,
    endExclusive: nextDay
      ? normalizeSchoolDateInput(nextDay, timeZone)
      : null,
  }
}

function inTermWindow(
  value: Date | null | undefined,
  bounds: TermBounds
): boolean {
  if (!value) return false
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return false
  if (bounds.startDate && date < bounds.startDate) return false
  if (bounds.endExclusive && date >= bounds.endExclusive) return false
  return true
}

function inTermDateString(date: string | null | undefined, bounds: TermBounds): boolean {
  if (!date) return false
  if (bounds.startString && date < bounds.startString) return false
  if (bounds.endString && date > bounds.endString) return false
  return true
}

function idOf(value: any): string {
  if (!value) return ''
  return String(value._id ?? value)
}

function compareTermsByStartDate(a: any, b: any): number {
  const aTime = a?.startDate ? new Date(a.startDate).getTime() : NaN
  const bTime = b?.startDate ? new Date(b.startDate).getTime() : NaN
  const aValid = Number.isFinite(aTime)
  const bValid = Number.isFinite(bTime)
  if (aValid && bValid && aTime !== bTime) return aTime - bTime
  if (aValid !== bValid) return aValid ? -1 : 1
  return Number(a?.sequence ?? 0) - Number(b?.sequence ?? 0)
}

/**
 * Loads every data set needed by all criteria for one student/window once.
 * Callers should reuse the context for every badge evaluated for that student.
 */
export async function buildBadgeEvaluationContext(input: {
  studentId: string | Types.ObjectId
  term: any
  schoolYear: string
  timeZone: string
  enrollment: any
}): Promise<BadgeEvaluationContext> {
  const studentId = new Types.ObjectId(String(input.studentId))
  const termId = String(input.term._id)
  const yearVariants = getYearVariants(input.schoolYear)

  const yearEnrollments = await StudentEnrollment.find({
    studentId,
    schoolYear: { $in: yearVariants },
  })
    .select('_id')
    .lean()

  const enrollmentIds = yearEnrollments.map((enrollment: any) => enrollment._id)

  const [attributeEvaluations, attendanceRows, termDocs] = await Promise.all([
    enrollmentIds.length > 0
      ? AttributeEvaluation.find({
          studentId,
          studentEnrollmentId: { $in: enrollmentIds },
        }).lean()
      : Promise.resolve([] as any[]),
    Attendance.find({
      studentId,
      schoolYear: { $in: yearVariants },
    }).lean(),
    AcademicTerm.find({ calendarId: input.term.calendarId })
      .sort({ sequence: 1 })
      .lean(),
  ])

  const terms = termDocs.length > 0 ? termDocs : [input.term]
  const termIds = terms.map((term: any) => term._id)

  const sectionIds = await AssessmentScore.distinct('sectionId', {
    studentId,
    academicTermId: { $in: termIds },
  })

  const academicRows: any[] = []
  if (sectionIds.length > 0) {
    for (const term of terms) {
      const rows = await AssessmentScore.aggregate([
        ...classPerformanceBasePipeline(term._id, sectionIds, studentId),
      ])
      academicRows.push(...rows)
    }
  }

  const [gsas, conductedRows] = await Promise.all([
    GradeSubjectAssessment.find({
      gradeId: input.enrollment.gradeId,
    })
      .populate({
        path: 'assessmentSetupId',
        populate: { path: 'assessmentTypeIds' },
      })
      .populate('subjectId', 'name')
      .lean(),
    input.enrollment?.sectionId
      ? ConductedAssessment.find({
          academicTermId: { $in: termIds },
          sectionId: input.enrollment.sectionId,
        })
          .select('gsaId academicTermId lockedStages')
          .lean()
      : Promise.resolve([] as any[]),
  ])

  const subjects: ContextSubject[] = []
  for (const gsa of gsas as any[]) {
    const setupTypes = (gsa.assessmentSetupId?.assessmentTypeIds ?? []).filter(
      (type: any) => type && typeof type === 'object' && type._id
    )
    const subjectRef = gsa.subjectId
    subjects.push({
      gsaId: String(gsa._id),
      subjectId: idOf(subjectRef),
      subjectName:
        subjectRef && typeof subjectRef === 'object'
          ? String(subjectRef.name ?? '')
          : '',
      setupStages: setupTypes.map((type: any) => ({
        id: String(type._id),
        weight: Number(type.weight) || 0,
      })),
    })
  }

  const lockedStagesByTermAndGsa = new Map<string, Set<string>>()
  for (const row of conductedRows as any[]) {
    const key = `${String(row.academicTermId)}:${String(row.gsaId)}`
    lockedStagesByTermAndGsa.set(
      key,
      new Set((row.lockedStages ?? []).map((id: any) => String(id)))
    )
  }

  return {
    studentId: String(studentId),
    term: input.term,
    termId,
    schoolYear: input.schoolYear,
    timeZone: input.timeZone,
    enrollment: input.enrollment,
    terms,
    attributeEvaluations,
    attendanceRows,
    academicRows,
    subjects,
    lockedStagesByTermAndGsa,
  }
}

function scopeOf(criterion: any): BadgeCriteriaScope {
  return criterion?.scope === 'year' ? 'year' : 'term'
}

function relevantSubjects(
  context: BadgeEvaluationContext,
  subjectId?: string | null
): ContextSubject[] {
  if (!subjectId) return context.subjects
  return context.subjects.filter((subject) => subject.subjectId === subjectId)
}

function computeLockStatus(
  context: BadgeEvaluationContext,
  termIds: string[],
  subjectId?: string | null
): LockStatus {
  const relevant = relevantSubjects(context, subjectId)
  const subjectProgress = new Map<string, SubjectLockProgress>()
  const termProgress = new Map<string, TermLockProgress>()

  let requiredStageCount = 0
  let lockedStageCount = 0
  let requiredWeight = 0
  let lockedWeight = 0

  for (const subject of relevant) {
    const progress = subjectProgress.get(subject.gsaId) ?? {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      requiredStageCount: 0,
      lockedStageCount: 0,
      fullyLocked: true,
    }

    for (const termId of termIds) {
      const term = termProgress.get(termId) ?? {
        termId,
        requiredStageCount: 0,
        lockedStageCount: 0,
      }
      const lockedStages =
        context.lockedStagesByTermAndGsa.get(`${termId}:${subject.gsaId}`) ??
        EMPTY_LOCKED_STAGES

      let termLocked = 0
      for (const stage of subject.setupStages) {
        const isLocked = lockedStages.has(stage.id)
        if (isLocked) {
          termLocked += 1
          lockedWeight += stage.weight
        }
        requiredWeight += stage.weight
      }

      const stageCount = subject.setupStages.length
      const fullyLocked =
        stageCount > 0 && termLocked === stageCount

      requiredStageCount += stageCount
      lockedStageCount += termLocked
      progress.requiredStageCount += stageCount
      progress.lockedStageCount += termLocked
      if (!fullyLocked) progress.fullyLocked = false

      term.requiredStageCount += stageCount
      term.lockedStageCount += termLocked
      termProgress.set(termId, term)
    }

    subjectProgress.set(subject.gsaId, progress)
  }

  const applicable = relevant.length > 0
  const fullyLocked =
    applicable &&
    requiredStageCount > 0 &&
    lockedStageCount === requiredStageCount &&
    Array.from(subjectProgress.values()).every(
      (subject) => subject.fullyLocked
    )

  return {
    applicable,
    fullyLocked,
    requiredStageCount,
    lockedStageCount,
    lockedShare:
      requiredStageCount > 0
        ? (lockedStageCount / requiredStageCount) * 100
        : 0,
    lockedWeightPercentage:
      requiredWeight > 0 ? (lockedWeight / requiredWeight) * 100 : 0,
    subjects: Array.from(subjectProgress.values()),
    terms: Array.from(termProgress.values()),
  }
}

function academicRowsFor(
  context: BadgeEvaluationContext,
  termIds: string[],
  subjectId?: string | null
): any[] {
  const termSet = new Set(termIds)
  return context.academicRows.filter((row: any) => {
    if (!termSet.has(String(row.academicTermId))) return false
    if (subjectId && String(row.subjectId) !== subjectId) return false
    return true
  })
}

function academicAverage(
  context: BadgeEvaluationContext,
  termIds: string[],
  subjectId?: string | null
): number | null {
  const rows = academicRowsFor(context, termIds, subjectId)
  const bySubject = new Map<string, { lockedScore: number; lockedWeight: number }>()

  for (const row of rows) {
    const key = String(row.subjectId)
    const current = bySubject.get(key) ?? { lockedScore: 0, lockedWeight: 0 }
    current.lockedScore += Number(row.lockedScore) || 0
    current.lockedWeight += Number(row.lockedWeight) || 0
    bySubject.set(key, current)
  }

  const percentages: number[] = []
  for (const subject of bySubject.values()) {
    if (subject.lockedWeight <= 0) continue
    percentages.push((subject.lockedScore / subject.lockedWeight) * 100)
  }

  if (percentages.length === 0) return null
  return percentages.reduce((sum, value) => sum + value, 0) / percentages.length
}

function subjectAveragesForTerms(
  context: BadgeEvaluationContext,
  termIds: string[]
): Map<string, number> {
  const rows = academicRowsFor(context, termIds)
  const bySubject = new Map<string, { lockedScore: number; lockedWeight: number }>()

  for (const row of rows) {
    const key = String(row.subjectId)
    const current = bySubject.get(key) ?? { lockedScore: 0, lockedWeight: 0 }
    current.lockedScore += Number(row.lockedScore) || 0
    current.lockedWeight += Number(row.lockedWeight) || 0
    bySubject.set(key, current)
  }

  const averages = new Map<string, number>()
  for (const [subjectId, subject] of bySubject) {
    if (subject.lockedWeight <= 0) continue
    averages.set(subjectId, (subject.lockedScore / subject.lockedWeight) * 100)
  }
  return averages
}

function termAttendanceRows(
  context: BadgeEvaluationContext,
  scope: BadgeCriteriaScope
): any[] {
  const bounds = termBounds(context.term, context.timeZone)
  const rows =
    scope === 'year'
      ? context.attendanceRows
      : context.attendanceRows.filter((row: any) => {
          const linkedTermId = row.academicTermId
            ? String(row.academicTermId)
            : null
          return linkedTermId
            ? linkedTermId === context.termId
            : inTermDateString(row.date, bounds)
        })
  return rows
}

function evaluateAttributeAverage(
  criterion: any,
  context: BadgeEvaluationContext
): CriterionResult {
  const scope = scopeOf(criterion)
  const bounds = termBounds(context.term, context.timeZone)
  const categoryId = criterion.attributeCategoryId
    ? String(criterion.attributeCategoryId)
    : null

  let evaluationCount = 0
  let itemCount = 0
  let scoreSum = 0

  for (const evaluation of context.attributeEvaluations) {
    if (scope === 'term') {
      const linkedTermId = evaluation.academicTermId
        ? String(evaluation.academicTermId)
        : null
      const included = linkedTermId
        ? linkedTermId === context.termId
        : inTermWindow(evaluation.createdAt, bounds)
      if (!included) continue
    }

    const relevant = (evaluation.attributes ?? []).filter((item: any) => {
      if (!item) return false
      return !categoryId || String(item.attributeId) === categoryId
    })
    if (relevant.length === 0) continue

    evaluationCount += 1
    for (const item of relevant) {
      const score = Number(item.score)
      if (!Number.isFinite(score)) continue
      scoreSum += score
      itemCount += 1
    }
  }

  const average = itemCount > 0 ? scoreSum / itemCount : null
  const requiredCount = Number(criterion.minEvaluationCount ?? 0)
  const target = Number(criterion.minScore ?? 0)
  const enoughData = evaluationCount >= requiredCount
  const met = enoughData && average !== null && average >= target

  return {
    criterionId: String(criterion._id),
    type: 'attributeAverage',
    scope,
    current: average === null ? null : round2(average),
    target,
    unit: 'score',
    enoughData,
    met,
    details: {
      evaluationCount,
      requiredEvaluationCount: requiredCount,
    },
  }
}

function evaluateAttendanceRate(
  criterion: any,
  context: BadgeEvaluationContext
): CriterionResult {
  const scope = scopeOf(criterion)
  const rows = termAttendanceRows(context, scope)

  const counts = {
    present: 0,
    late: 0,
    excused: 0,
    total: rows.length,
  }
  const recordedDates = new Set<string>()

  for (const row of rows as any[]) {
    if (row.date) recordedDates.add(String(row.date))
    if (row.status === 'present') counts.present += 1
    else if (row.status === 'late') counts.late += 1
    else if (row.status === 'excused') counts.excused += 1
  }

  // Badge evaluation counts excused absences as absences. Non-badge surfaces
  // keep the shared util's default behaviour.
  const rate = calculateAttendanceRate(counts, true)
  const recordedSchoolDays = recordedDates.size
  const requiredDays = Number(criterion.minRecordedSchoolDays ?? 0)
  const target = Number(criterion.minPercentage ?? 0)
  const enoughData = recordedSchoolDays >= requiredDays && rate !== null
  const met = enoughData && rate !== null && rate >= target

  return {
    criterionId: String(criterion._id),
    type: 'attendanceRate',
    scope,
    current: rate === null ? null : round2(rate),
    target,
    unit: 'percent',
    enoughData,
    met,
    details: {
      recordedSchoolDays,
      requiredRecordedSchoolDays: requiredDays,
      presentCount: counts.present,
      lateCount: counts.late,
      excusedCount: counts.excused,
      absentCount: counts.total - counts.present - counts.late,
    },
  }
}

function evaluateAttendanceStreak(
  criterion: any,
  context: BadgeEvaluationContext
): CriterionResult {
  const scope: BadgeCriteriaScope = 'term'
  const mode: BadgeStreakMode =
    criterion.mode === 'onTime' ? 'onTime' : 'noAbsence'
  const rows = termAttendanceRows(context, scope)

  const byDate = new Map<string, { absent: boolean; late: boolean }>()
  for (const row of rows as any[]) {
    const date = row.date ? String(row.date) : ''
    if (!date) continue
    const current = byDate.get(date) ?? { absent: false, late: false }
    if (row.status === 'absent' || row.status === 'excused') {
      current.absent = true
    }
    if (row.status === 'late') current.late = true
    byDate.set(date, current)
  }

  // Dates with no record are skipped, so weekends and holidays neither extend
  // nor break a streak.
  const dates = Array.from(byDate.keys()).sort()
  let bestStreak = 0
  let currentStreak = 0
  for (const date of dates) {
    const record = byDate.get(date)!
    const clean =
      mode === 'onTime' ? !record.absent && !record.late : !record.absent
    if (clean) {
      currentStreak += 1
      if (currentStreak > bestStreak) bestStreak = currentStreak
    } else {
      currentStreak = 0
    }
  }

  const target = Number(criterion.minDays ?? 0)
  const recordedDays = dates.length
  const enoughData = recordedDays > 0
  const met = bestStreak >= target

  return {
    criterionId: String(criterion._id),
    type: 'attendanceStreak',
    scope,
    current: bestStreak,
    target,
    unit: 'days',
    enoughData,
    met,
    details: {
      mode,
      recordedDays,
      bestStreak,
      currentStreak,
      target,
    },
  }
}

function evaluateAcademicAverage(
  criterion: any,
  context: BadgeEvaluationContext
): CriterionResult {
  const scope = scopeOf(criterion)
  const termIds =
    scope === 'year'
      ? context.terms.map((term: any) => String(term._id))
      : [context.termId]
  const subjectId = criterion.subjectId ? String(criterion.subjectId) : null

  const lock = computeLockStatus(context, termIds, subjectId)
  const average = academicAverage(context, termIds, subjectId)
  const target = Number(criterion.minPercentage ?? 0)
  const subjectHasSetup = subjectId
    ? context.subjects.some((subject) => subject.subjectId === subjectId)
    : context.subjects.length > 0

  const enoughData = lock.fullyLocked && average !== null
  const met = enoughData && average !== null && average >= target
  const subjectName = subjectId
    ? relevantSubjects(context, subjectId)[0]?.subjectName ?? ''
    : ''

  return {
    criterionId: String(criterion._id),
    type: 'academicAverage',
    scope,
    current: average === null ? null : round2(average),
    target,
    unit: 'percent',
    enoughData,
    met,
    waitingForAssessments: !lock.fullyLocked,
    lockedShare: round2(lock.lockedShare),
    details: {
      subjectId,
      subjectName,
      subjectHasSetup,
      fullyLocked: lock.fullyLocked,
      waitingForAssessments: !lock.fullyLocked,
      lockedShare: round2(lock.lockedShare),
      lockedWeightPercentage: round2(lock.lockedWeightPercentage),
      lockedStageCount: lock.lockedStageCount,
      requiredStageCount: lock.requiredStageCount,
    },
  }
}

function evaluateAcademicImprovement(
  criterion: any,
  context: BadgeEvaluationContext
): CriterionResult {
  const target = Number(criterion.minPoints ?? 0)
  const orderedTerms = [...context.terms].sort(compareTermsByStartDate)
  const currentIndex = orderedTerms.findIndex(
    (term: any) => String(term._id) === context.termId
  )
  const previousTerm =
    currentIndex > 0 ? orderedTerms[currentIndex - 1] : null

  if (!previousTerm) {
    return {
      criterionId: String(criterion._id),
      type: 'academicImprovement',
      scope: 'term',
      current: null,
      target,
      unit: 'points',
      enoughData: false,
      met: false,
      notApplicable: true,
      waitingForAssessments: false,
      lockedShare: null,
      details: {
        notApplicable: true,
        reason: 'No previous term in the current academic year',
        currentTermId: context.termId,
        currentTermAverage: null,
        previousTermId: null,
        previousTermAverage: null,
        changePoints: null,
        currentTermFullyLocked: false,
        previousTermFullyLocked: false,
        fullyLocked: false,
        waitingForAssessments: false,
        lockedShare: null,
      },
    }
  }

  const previousTermId = String(previousTerm._id)
  const currentLock = computeLockStatus(context, [context.termId])
  const previousLock = computeLockStatus(context, [previousTermId])
  const currentTermAverage = academicAverage(context, [context.termId])
  const previousTermAverage = academicAverage(context, [previousTermId])
  const changePoints =
    currentTermAverage !== null && previousTermAverage !== null
      ? currentTermAverage - previousTermAverage
      : null

  const fullyLocked = currentLock.fullyLocked && previousLock.fullyLocked
  const enoughData = fullyLocked && changePoints !== null
  const met = enoughData && changePoints !== null && changePoints >= target

  const requiredStageCount =
    currentLock.requiredStageCount + previousLock.requiredStageCount
  const lockedStageCount =
    currentLock.lockedStageCount + previousLock.lockedStageCount
  const lockedShare =
    requiredStageCount > 0 ? (lockedStageCount / requiredStageCount) * 100 : 0

  return {
    criterionId: String(criterion._id),
    type: 'academicImprovement',
    scope: 'term',
    current: changePoints === null ? null : round2(changePoints),
    target,
    unit: 'points',
    enoughData,
    met,
    notApplicable: false,
    waitingForAssessments: !fullyLocked,
    lockedShare: round2(lockedShare),
    details: {
      notApplicable: false,
      currentTermId: context.termId,
      currentTermName: String(context.term?.name ?? ''),
      currentTermAverage:
        currentTermAverage === null ? null : round2(currentTermAverage),
      previousTermId,
      previousTermName: String(previousTerm.name ?? ''),
      previousTermAverage:
        previousTermAverage === null ? null : round2(previousTermAverage),
      changePoints: changePoints === null ? null : round2(changePoints),
      target,
      currentTermFullyLocked: currentLock.fullyLocked,
      previousTermFullyLocked: previousLock.fullyLocked,
      fullyLocked,
      waitingForAssessments: !fullyLocked,
      currentTermLockedShare: round2(currentLock.lockedShare),
      previousTermLockedShare: round2(previousLock.lockedShare),
      lockedShare: round2(lockedShare),
      lockedStageCount,
      requiredStageCount,
    },
  }
}

function evaluateAcademicConsistency(
  criterion: any,
  context: BadgeEvaluationContext
): CriterionResult {
  const termIds = [context.termId]
  const lock = computeLockStatus(context, termIds)
  const averages = subjectAveragesForTerms(context, termIds)
  const target = Number(criterion.minPercentage ?? 0)

  let lowestAverage: number | null = null
  let lowestSubjectId: string | null = null
  let lowestSubjectName = ''
  let allMeet = lock.applicable

  const subjectAverages = context.subjects.map((subject) => {
    const average = averages.get(subject.subjectId)
    const hasAverage = average !== undefined
    if (!hasAverage) {
      allMeet = false
    } else {
      if (lowestAverage === null || average < lowestAverage) {
        lowestAverage = average
        lowestSubjectId = subject.subjectId
        lowestSubjectName = subject.subjectName
      }
      if (average < target) allMeet = false
    }
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      average: hasAverage ? round2(average) : null,
      met: hasAverage && average >= target,
    }
  })

  const enoughData = lock.fullyLocked && lowestAverage !== null
  const met = enoughData && allMeet && lowestAverage !== null

  return {
    criterionId: String(criterion._id),
    type: 'academicConsistency',
    scope: 'term',
    current: lowestAverage === null ? null : round2(lowestAverage),
    target,
    unit: 'percent',
    enoughData,
    met,
    notApplicable: false,
    waitingForAssessments: !lock.fullyLocked,
    lockedShare: round2(lock.lockedShare),
    details: {
      fullyLocked: lock.fullyLocked,
      waitingForAssessments: !lock.fullyLocked,
      lockedShare: round2(lock.lockedShare),
      lockedWeightPercentage: round2(lock.lockedWeightPercentage),
      lockedStageCount: lock.lockedStageCount,
      requiredStageCount: lock.requiredStageCount,
      subjectCount: context.subjects.length,
      lowestSubjectId,
      lowestSubjectName,
      lowestSubjectAverage:
        lowestAverage === null ? null : round2(lowestAverage),
      target,
      subjectAverages,
    },
  }
}

function evaluateUnsupported(criterion: any): CriterionResult {
  return {
    criterionId: String(criterion._id),
    type: criterion?.type as BadgeCriteriaType,
    scope: criterion?.scope ?? null,
    current: null,
    target: null,
    unit: 'manual',
    enoughData: false,
    met: false,
    details: { unsupported: true },
  }
}

/** Evaluates one badge using a context that can be shared across badges. */
export function evaluateBadgeCriteria(
  badge: any,
  context: BadgeEvaluationContext
): BadgeEvaluationResult {
  const criteria: CriterionResult[] = (badge.criteria ?? []).map(
    (criterion: any) => {
      if (criterion.type === 'attributeAverage') {
        return evaluateAttributeAverage(criterion, context)
      }
      if (criterion.type === 'attendanceRate') {
        return evaluateAttendanceRate(criterion, context)
      }
      if (criterion.type === 'attendanceStreak') {
        return evaluateAttendanceStreak(criterion, context)
      }
      if (criterion.type === 'academicAverage') {
        return evaluateAcademicAverage(criterion, context)
      }
      if (criterion.type === 'academicImprovement') {
        return evaluateAcademicImprovement(criterion, context)
      }
      if (criterion.type === 'academicConsistency') {
        return evaluateAcademicConsistency(criterion, context)
      }
      return evaluateUnsupported(criterion)
    }
  )

  return {
    criteria,
    allMet:
      criteria.length > 0 &&
      criteria.every((criterion) => criterion.enoughData && criterion.met),
  }
}
