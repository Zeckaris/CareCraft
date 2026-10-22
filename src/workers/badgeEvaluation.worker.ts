import { BadgeDefinition } from '../models/badgeDefinition.model.js'
import { BadgeAwardSuppression } from '../models/badgeAwardSuppression.model.js'
import { Student } from '../models/student.model.js'
import { StudentBadge } from '../models/studentBadge.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { Worker } from 'bullmq'
import { queues } from '../redis/queueManager.js'
import {
  buildBadgeEvaluationContext,
  evaluateBadgeCriteria,
} from '../badges/criteriaEvaluator.js'
import {
  resolveCurrentBadgeEnrollment,
  resolveCurrentBadgeWindow,
} from '../service/badgeWindow.service.js'
import { queueStudentEvaluationJobs } from '../service/badgeEvaluationQueue.service.js'
import { awardStudentBadge } from '../service/studentBadgeAward.service.js'
import { getSchoolTimezone } from '../utils/schoolDate.util.js'
import { getYearVariants } from '../utils/yearNormalizer.js'
import { createWorker } from './baseWorker.js'
import type {
  BadgeEvaluationJobData,
  IEvaluateBadgeJobData,
  IEvaluateSectionJobData,
  IEvaluateStudentJobData,
} from '../types/badgeEvaluationJob.type.js'

let badgeWorker: Worker<BadgeEvaluationJobData> | null = null
let shuttingDown = false

async function processStudentJob(data: IEvaluateStudentJobData): Promise<void> {
  const { term, schoolYear, snapshot } = await resolveCurrentBadgeWindow()
  if (!term || !schoolYear || !snapshot.currentCalendar) return

  const student = await Student.findById(data.studentId)
    .select('firstName middleName lastName parentId')
    .lean()
  if (!student) return

  const enrollment = await resolveCurrentBadgeEnrollment(
    student._id,
    schoolYear
  )
  if (!enrollment) return

  const badges = await BadgeDefinition.find({
    autoAward: true,
    eligibleGrades: enrollment.gradeId,
  })
    .populate('criteria')
    .lean()
  if (badges.length === 0) return

  const [awards, suppressions] = await Promise.all([
    StudentBadge.find({
      studentId: student._id,
      academicTermId: term._id,
    })
      .select('badgeId')
      .lean(),
    BadgeAwardSuppression.find({
      studentId: student._id,
      academicTermId: term._id,
    })
      .select('badgeId')
      .lean(),
  ])

  const awardedBadgeIds = new Set(
    awards.map((award: any) => String(award.badgeId))
  )
  const suppressedBadgeIds = new Set(
    suppressions.map((suppression: any) => String(suppression.badgeId))
  )

  const context = await buildBadgeEvaluationContext({
    studentId: student._id,
    term,
    schoolYear,
    timeZone: snapshot.timeZone,
    enrollment,
  })

  for (const badge of badges as any[]) {
    const badgeId = String(badge._id)
    if (awardedBadgeIds.has(badgeId) || suppressedBadgeIds.has(badgeId)) {
      continue
    }

    const evaluation = evaluateBadgeCriteria(badge, context)
    if (!evaluation.allMet) continue

    const result = await awardStudentBadge({
      badge,
      student,
      term,
      actor: { type: 'system' },
    })

    if (result.status === 'failed') {
      console.warn(
        `[badgeEvaluationWorker] Could not award badge ${badgeId} to student ${data.studentId}: ${result.message}`
      )
    }
  }
}

async function activeStudentsForWindow(input: {
  sectionId?: any
  badgeId?: any
}): Promise<{ studentIds: string[]; termId: string } | null> {
  const { term, schoolYear } = await resolveCurrentBadgeWindow()
  if (!term || !schoolYear) return null

  if (input.sectionId) {
    const enrollments = await StudentEnrollment.find({
      sectionId: input.sectionId,
      isActive: true,
      schoolYear: { $in: getYearVariants(schoolYear) },
    })
      .select('studentId')
      .lean()
    return {
      studentIds: enrollments.map((enrollment: any) => String(enrollment.studentId)),
      termId: String(term._id),
    }
  }

  if (input.badgeId) {
    const badge = await BadgeDefinition.findById(input.badgeId)
      .select('autoAward eligibleGrades')
      .lean()
    if (!badge || !badge.autoAward) return null

    const enrollments = await StudentEnrollment.find({
      isActive: true,
      gradeId: { $in: badge.eligibleGrades ?? [] },
      schoolYear: { $in: getYearVariants(schoolYear) },
    })
      .select('studentId')
      .lean()
    return {
      studentIds: enrollments.map((enrollment: any) => String(enrollment.studentId)),
      termId: String(term._id),
    }
  }

  return null
}

async function processSectionJob(data: IEvaluateSectionJobData): Promise<void> {
  const expanded = await activeStudentsForWindow({
    sectionId: data.sectionId,
  })
  if (!expanded) return
  await queueStudentEvaluationJobs(expanded.studentIds, expanded.termId)
}

async function processBadgeJob(data: IEvaluateBadgeJobData): Promise<void> {
  const expanded = await activeStudentsForWindow({ badgeId: data.badgeId })
  if (!expanded) return
  await queueStudentEvaluationJobs(expanded.studentIds, expanded.termId)
}

async function runNightlySweep(): Promise<void> {
  const { term, schoolYear } = await resolveCurrentBadgeWindow()
  if (!term || !schoolYear) return

  const badges = await BadgeDefinition.find({
    autoAward: true,
    'eligibleGrades.0': { $exists: true },
  })
    .select('eligibleGrades')
    .lean()

  const gradeIds = new Set<string>()
  for (const badge of badges as any[]) {
    for (const gradeId of badge.eligibleGrades ?? []) {
      gradeIds.add(String(gradeId))
    }
  }
  if (gradeIds.size === 0) return

  const enrollments = await StudentEnrollment.find({
    isActive: true,
    gradeId: { $in: Array.from(gradeIds) },
    schoolYear: { $in: getYearVariants(schoolYear) },
  })
    .select('studentId')
    .lean()

  await queueStudentEvaluationJobs(
    enrollments.map((enrollment: any) => String(enrollment.studentId)),
    String(term._id)
  )
}

async function processBadgeEvaluationJob(
  job: { name: string; data: BadgeEvaluationJobData }
): Promise<void> {
  if (job.name === 'evaluate-student') {
    await processStudentJob(job.data as IEvaluateStudentJobData)
    return
  }
  if (job.name === 'evaluate-section') {
    await processSectionJob(job.data as IEvaluateSectionJobData)
    return
  }
  if (job.name === 'evaluate-badge') {
    await processBadgeJob(job.data as IEvaluateBadgeJobData)
    return
  }
  if (job.name === 'nightly-sweep') {
    await runNightlySweep()
    return
  }
  console.warn(`[badgeEvaluationWorker] Unknown job name: ${job.name}`)
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try {
    if (badgeWorker) await badgeWorker.close()
    await queues.badgeEvaluation.close()
  } catch (error) {
    console.error('Failed to close badge evaluation worker:', error)
  }
}

/**
 * Starts the badge evaluation worker only after the database is connected.
 * The repeatable nightly sweep is registered through BullMQ job schedulers.
 */
export async function startBadgeEvaluationWorker(): Promise<void> {
  if (badgeWorker) return

  badgeWorker = createWorker<BadgeEvaluationJobData>(
    'badge-evaluation-queue',
    async (job) => {
      await processBadgeEvaluationJob(job)
    },
    2
  )

  try {
    const timeZone = await getSchoolTimezone()
    const pattern = process.env.BADGE_SWEEP_CRON || '0 2 * * *'
    await queues.badgeEvaluation.upsertJobScheduler(
      'badge-nightly-sweep',
      { pattern, tz: timeZone },
      { name: 'nightly-sweep', data: {} }
    )
  } catch (error) {
    console.error('Failed to register badge nightly sweep:', error)
  }

  process.once('SIGTERM', () => {
    void shutdown()
  })
  process.once('SIGINT', () => {
    void shutdown()
  })
}
