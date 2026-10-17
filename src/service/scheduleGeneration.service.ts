import { Worker } from 'node:worker_threads'
import { Types } from 'mongoose'
import { GenerationJob } from '../models/generationJob.model.js'
import { Schedule } from '../models/schedule.model.js'
import { ScheduleEntry } from '../models/scheduleEntry.model.js'
import { collectScheduleData } from './scheduleData.service.js'

export const GENERATION_LIMITS = {
  defaultIterationBudget: 4000,
  maxIterationBudget: 200000,
  defaultTimeBudgetMs: 20000,
  maxTimeBudgetMs: 120000,
}

interface WorkerResult {
  entries: any[]
  unplaced: any[]
  stats: any
  violations: any[]
}

interface RunInput {
  jobId: string
  seed: number
  iterationBudget: number
  timeBudgetMs: number
}

/** True for a MongoDB duplicate-key (E11000) error. */
export function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: number }).code === 11000
}

function workerUrl(): URL {
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
  return new URL(`../workers/scheduleGeneration.worker${ext}`, import.meta.url)
}

function runWorker(
  workerData: unknown,
  onPhase: (phase: string, percent: number) => void
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl(), { workerData })
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
      worker.terminate().catch(() => undefined)
    }

    worker.on('message', (msg: any) => {
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'phase') {
        onPhase(String(msg.phase), Number(msg.percent) || 0)
      } else if (msg.type === 'result') {
        done(() => resolve(msg.payload as WorkerResult))
      } else if (msg.type === 'error') {
        done(() => reject(new Error(msg.error?.message ?? 'Solver worker failed')))
      }
    })
    worker.on('error', (err) => done(() => reject(err)))
    worker.on('exit', (code) => {
      if (code !== 0) done(() => reject(new Error(`Solver worker exited with code ${code}`)))
    })
  })
}

async function setProgress(
  jobId: string,
  phase: string,
  percent: number,
  message?: string
): Promise<void> {
  await GenerationJob.updateOne(
    { _id: jobId },
    { $set: { progress: { phase, percent, message: message ?? null } } }
  )
}

/** Thrown when the DB-level "one draft per school year" index rejects an insert. */
export class DuplicateDraftError extends Error {
  code = 'DRAFT_CONFLICT'
  constructor(schoolYear: string) {
    super(`A draft schedule already exists for ${schoolYear}`)
    this.name = 'DuplicateDraftError'
  }
}

interface PersistInput {
  schoolYear: string
  fingerprint: string
  settingsSnapshot: unknown
  generatedBy: unknown
  entries: any[]
  unplaced: any[]
  stats: any
  clonedFrom?: unknown
}

interface PreparedLocked {
  valid: any[]
  dropped: Array<{
    entryId: string
    sectionId: string
    subjectId: string
    day: string
    period: number
    reason: string
  }>
}

/** Maps a stored entry document to the plain solver entry shape. */
function toSolverEntry(doc: any): any {
  return {
    _id: String(doc._id),
    sectionId: String(doc.sectionId),
    gradeId: String(doc.gradeId),
    subjectId: String(doc.subjectId),
    teacherId: String(doc.teacherId),
    teachingAssignmentId: String(doc.teachingAssignmentId),
    day: doc.day,
    period: doc.period,
    doubleGroupId: doc.doubleGroupId ?? null,
    locked: true,
  }
}

/**
 * Keeps only locked entries that are still valid against the current data and
 * reports the rest with a reason. A locked double is kept only if both halves
 * remain valid and adjacent in the same block.
 */
function prepareLockedEntries(entries: any[], data: Awaited<ReturnType<typeof collectScheduleData>>): PreparedLocked {
  const lessonByKey = new Map(data.lessons.map((l) => [l.lessonId, l]))
  const layout = new Map((data.settings?.perDay ?? []).map((d) => [d.day, d]))

  const valid: any[] = []
  const dropped: PreparedLocked['dropped'] = []
  const drop = (e: any, reason: string) =>
    dropped.push({
      entryId: String(e._id ?? ''),
      sectionId: String(e.sectionId),
      subjectId: String(e.subjectId),
      day: e.day,
      period: e.period,
      reason,
    })

  for (const e of entries) {
    const lesson = lessonByKey.get(`${e.sectionId}::${e.subjectId}`)
    if (!lesson) {
      drop(e, 'SUBJECT_NO_LONGER_REQUIRED')
      continue
    }
    if (lesson.teacherId !== e.teacherId || lesson.teachingAssignmentId !== e.teachingAssignmentId) {
      drop(e, 'TEACHER_REASSIGNED')
      continue
    }
    const dl: any = layout.get(e.day)
    if (!dl || !Number.isInteger(e.period) || e.period < 1 || e.period > dl.periodsPerDay) {
      drop(e, 'BELL_SCHEDULE_CHANGED')
      continue
    }
    valid.push(e)
  }

  // Drop incomplete/invalid doubles as a unit.
  const groups = new Map<string, any[]>()
  for (const e of valid) {
    if (!e.doubleGroupId) continue
    if (!groups.has(e.doubleGroupId)) groups.set(e.doubleGroupId, [])
    groups.get(e.doubleGroupId)!.push(e)
  }
  const bad = new Set<string>()
  for (const [, list] of groups) {
    const [a, b] = list
    const dl: any = a ? layout.get(a.day) : undefined
    const ok =
      list.length === 2 &&
      a.day === b.day &&
      Math.abs(a.period - b.period) === 1 &&
      !!dl &&
      dl.groupIndex[a.period - 1] === dl.groupIndex[b.period - 1] &&
      a.sectionId === b.sectionId &&
      a.subjectId === b.subjectId &&
      a.teacherId === b.teacherId
    if (!ok) list.forEach((e) => bad.add(e._id))
  }
  const kept = valid.filter((e) => {
    if (e.doubleGroupId && bad.has(e._id)) {
      drop(e, 'DOUBLE_INVALID')
      return false
    }
    return true
  })

  return { valid: kept, dropped }
}

/** Moves any current draft(s) for the year out of `draft` to free the unique slot. */
async function archiveExistingDrafts(schoolYear: string): Promise<Types.ObjectId[]> {
  const drafts = await Schedule.find({ schoolYear, status: 'draft' }).select('_id').lean()
  const ids = drafts.map((d: any) => d._id)
  if (ids.length > 0) {
    await Schedule.updateMany({ _id: { $in: ids } }, { $set: { status: 'archived' } })
  }
  return ids
}

async function restoreArchivedToDraft(ids: Types.ObjectId[]): Promise<void> {
  if (ids.length === 0) return
  try {
    await Schedule.updateMany({ _id: { $in: ids } }, { $set: { status: 'draft' } })
  } catch {
    // A concurrent draft now occupies the unique slot; leave the docs archived.
  }
}

/**
 * Persists a solved schedule as the year's draft.
 *
 * Index-safe replacement order: existing draft(s) are first archived (freeing
 * the partial unique slot), the new draft and its entries are saved, and only
 * then are the archived draft(s) and their entries deleted. If anything fails
 * before the new draft is complete, the archived draft(s) are restored and the
 * partially written new draft is removed.
 */
export async function persistDraftSchedule(input: PersistInput): Promise<any> {
  const archivedIds = await archiveExistingDrafts(input.schoolYear)

  let schedule: any
  try {
    schedule = await Schedule.create({
      schoolYear: input.schoolYear,
      status: 'draft',
      fingerprint: input.fingerprint,
      settingsSnapshot: input.settingsSnapshot ?? null,
      entryCount: input.entries.length,
      unplaced: input.unplaced,
      stats: { ...input.stats, unplacedCount: input.unplaced.length },
      clonedFrom: input.clonedFrom ?? null,
      generatedBy: input.generatedBy,
      generatedAt: new Date(),
    })
  } catch (error) {
    await restoreArchivedToDraft(archivedIds)
    if (isDuplicateKeyError(error)) throw new DuplicateDraftError(input.schoolYear)
    throw error
  }

  try {
    if (input.entries.length > 0) {
      await ScheduleEntry.insertMany(
        input.entries.map((e: any) => ({
          scheduleId: schedule._id,
          schoolYear: input.schoolYear,
          sectionId: new Types.ObjectId(String(e.sectionId)),
          gradeId: new Types.ObjectId(String(e.gradeId)),
          subjectId: new Types.ObjectId(String(e.subjectId)),
          teacherId: new Types.ObjectId(String(e.teacherId)),
          teachingAssignmentId: new Types.ObjectId(String(e.teachingAssignmentId)),
          day: e.day,
          period: e.period,
          doubleGroupId: e.doubleGroupId ?? null,
          locked: !!e.locked,
        }))
      )
    }
  } catch (error) {
    await Schedule.deleteOne({ _id: schedule._id })
    await restoreArchivedToDraft(archivedIds)
    throw error
  }

  // New draft fully saved; retire the archived previous draft(s) now.
  if (archivedIds.length > 0) {
    await ScheduleEntry.deleteMany({ scheduleId: { $in: archivedIds } })
    await Schedule.deleteMany({ _id: { $in: archivedIds } })
  }

  return schedule
}

/**
 * Runs one generation job end to end: collect data → solve in a worker thread →
 * persist a new draft schedule → retire the previous draft. Never throws; the
 * job document always ends in `completed` or `failed`.
 */
export async function runGenerationJob(input: RunInput): Promise<void> {
  const { jobId } = input
  try {
    const job = await GenerationJob.findById(jobId)
    if (!job) return

    await GenerationJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'running',
          startedAt: new Date(),
          progress: { phase: 'collecting', percent: 10, message: null },
        },
      }
    )

    const data = await collectScheduleData(job.schoolYear)

    if (!data.settings || !data.precheck.ok) {
      await GenerationJob.updateOne(
        { _id: jobId },
        {
          $set: {
            status: 'failed',
            finishedAt: new Date(),
            error: { message: 'Schedule data failed the precheck', code: 'PRECHECK_FAILED' },
            precheck: {
              ok: data.precheck.ok,
              errors: data.precheck.errors.length,
              warnings: data.precheck.warnings.length,
            },
            progress: { phase: 'failed', percent: 100, message: 'Precheck failed' },
          },
        }
      )
      return
    }

    await GenerationJob.updateOne(
      { _id: jobId },
      {
        $set: {
          precheck: {
            ok: true,
            errors: 0,
            warnings: data.precheck.warnings.length,
          },
        },
      }
    )

    // Regeneration around locks: reuse the current draft's locked entries as
    // fixed input (counted toward the weekly requirements), dropping any that
    // are no longer valid against the current data.
    let lockedEntries: any[] = []
    let droppedLocked: PreparedLocked['dropped'] = []
    if (job.keepLocked) {
      const draft = await Schedule.findOne({ schoolYear: job.schoolYear, status: 'draft' })
        .select('_id')
        .lean()
      if (draft) {
        const lockedDocs = await ScheduleEntry.find({ scheduleId: draft._id, locked: true }).lean()
        const prepared = prepareLockedEntries(lockedDocs.map(toSolverEntry), data)
        lockedEntries = prepared.valid
        droppedLocked = prepared.dropped
      }
    }

    const result = await runWorker(
      {
        settings: data.settings,
        lessons: data.lessons,
        lockedEntries,
        seed: input.seed,
        iterationBudget: input.iterationBudget,
        timeBudgetMs: input.timeBudgetMs,
      },
      (phase, percent) => {
        void setProgress(jobId, phase, percent)
      }
    )

    if (result.stats.hardViolations > 0 || result.violations.length > 0) {
      await GenerationJob.updateOne(
        { _id: jobId },
        {
          $set: {
            status: 'failed',
            finishedAt: new Date(),
            error: {
              message: `Generated schedule failed validation (${result.violations.length} violation(s), ${result.stats.hardViolations} hard)`,
              code: 'VALIDATION_FAILED',
            },
            progress: { phase: 'failed', percent: 100, message: 'Validation failed' },
          },
        }
      )
      return
    }

    await setProgress(jobId, 'persisting', 92)

    const schedule = await persistDraftSchedule({
      schoolYear: data.schoolYear,
      fingerprint: data.fingerprint,
      settingsSnapshot: data.settingData,
      generatedBy: job.requestedBy,
      entries: result.entries,
      unplaced: result.unplaced,
      stats: result.stats,
    })

    await GenerationJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'completed',
          finishedAt: new Date(),
          result: {
            scheduleId: schedule._id,
            entryCount: result.entries.length,
            unplacedCount: result.unplaced.length,
            stats: result.stats,
            droppedLocked,
          },
          progress: { phase: 'done', percent: 100, message: null },
        },
      }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = error instanceof DuplicateDraftError ? error.code : 'GENERATION_ERROR'
    await GenerationJob.updateOne(
      { _id: jobId },
      {
        $set: {
          status: 'failed',
          finishedAt: new Date(),
          error: { message, code },
          progress: { phase: 'failed', percent: 100, message },
        },
      }
    ).catch(() => undefined)
  }
}

/** Marks jobs left queued/running by a restart as failed. */
export async function recoverStaleGenerationJobs(): Promise<void> {
  try {
    await GenerationJob.updateMany(
      { status: { $in: ['queued', 'running'] } },
      {
        $set: {
          status: 'failed',
          finishedAt: new Date(),
          error: { message: 'Server restarted before the job finished', code: 'STALE_JOB' },
          progress: { phase: 'failed', percent: 100, message: 'Interrupted by restart' },
        },
      }
    )
  } catch (error) {
    console.error('Failed to recover stale generation jobs', error)
  }
}
