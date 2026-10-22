import { queues } from '../redis/queueManager.js'
import { getCurrentTerm } from './currentAcademic.service.js'

const STUDENT_JOB_DELAY_MS = 30_000
const BATCH_SIZE = 100

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400, count: 1_000 },
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

/**
 * Queues student evaluation jobs with a stable student + term job id so bursts
 * coalesce. This internal helper may throw; public trigger helpers catch it.
 */
export async function queueStudentEvaluationJobs(
  studentIds: Array<string | undefined | null>,
  termId: string
): Promise<void> {
  const uniqueIds = Array.from(
    new Set(studentIds.filter((id): id is string => Boolean(id)))
  )
  if (uniqueIds.length === 0 || !termId) return

  for (const batch of chunk(uniqueIds, BATCH_SIZE)) {
    await queues.badgeEvaluation.addBulk(
      batch.map((studentId) => ({
        name: 'evaluate-student' as const,
        data: { studentId },
        opts: {
          ...DEFAULT_JOB_OPTIONS,
          delay: STUDENT_JOB_DELAY_MS,
          jobId: `${studentId}-${termId}`,
          // Remove student jobs as soon as they finish so the stable job id
          // only coalesces in-flight evaluations, not later triggers.
          removeOnComplete: true,
          removeOnFail: true,
        },
      }))
    )
  }
}

/**
 * Request-handler-safe helper. It never throws into the caller.
 */
export async function enqueueStudentBadgeEvaluations(
  studentIds: Array<string | undefined | null> | string
): Promise<void> {
  try {
    const ids = Array.isArray(studentIds) ? studentIds : [studentIds]
    const term = await getCurrentTerm()
    if (!term) return
    await queueStudentEvaluationJobs(ids, String(term._id))
  } catch (error) {
    console.error('Failed to enqueue student badge evaluations:', error)
  }
}

export async function enqueueSectionBadgeEvaluation(
  sectionId: string
): Promise<void> {
  try {
    if (!sectionId) return
    await queues.badgeEvaluation.add(
      'evaluate-section',
      { sectionId },
      DEFAULT_JOB_OPTIONS
    )
  } catch (error) {
    console.error('Failed to enqueue section badge evaluation:', error)
  }
}

export async function enqueueBadgeEvaluationForBadge(
  badgeId: string
): Promise<void> {
  try {
    if (!badgeId) return
    await queues.badgeEvaluation.add(
      'evaluate-badge',
      { badgeId },
      DEFAULT_JOB_OPTIONS
    )
  } catch (error) {
    console.error('Failed to enqueue badge evaluation:', error)
  }
}
