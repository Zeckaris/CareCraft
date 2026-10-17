import { Request, Response } from 'express'
import { GenerationJob } from '../models/generationJob.model.js'
import { Schedule } from '../models/schedule.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { normalizeYear } from '../utils/yearNormalizer.js'
import { isValidSchoolYear } from '../utils/schoolYear.util.js'
import { collectScheduleData } from '../service/scheduleData.service.js'
import {
  GENERATION_LIMITS,
  isDuplicateKeyError,
  runGenerationJob,
} from '../service/scheduleGeneration.service.js'
import { AuthRequest } from '../middlewares/auth.middleware.js'

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/**
 * POST /api/schedule/generate
 * Roles: admin, coordinator
 *
 * Runs the precheck first (errors block the run; warnings do not). Refuses with
 * 409 when another generation is already active for the year or when a draft
 * exists and `replaceExistingDraft` was not set. Responds 202 with the job.
 */
export const generateSchedule = async (req: AuthRequest, res: Response): Promise<void> => {
  const { schoolYear, seed, iterationBudget, timeBudgetMs, replaceExistingDraft, keepLocked } =
    req.body ?? {}

  if (!schoolYear || typeof schoolYear !== 'string' || !isValidSchoolYear(schoolYear)) {
    sendResponse(res, 400, false, 'A valid schoolYear (YYYY-YYYY) is required')
    return
  }

  try {
    const canonicalYear = normalizeYear(schoolYear)

    const data = await collectScheduleData(canonicalYear)
    if (!data.precheck.ok) {
      sendResponse(res, 400, false, 'Schedule data failed the precheck', {
        precheck: data.precheck,
      })
      return
    }

    const activeJob = await GenerationJob.findOne({
      schoolYear: canonicalYear,
      status: { $in: ['queued', 'running'] },
    }).lean()
    if (activeJob) {
      sendResponse(res, 409, false, 'A generation is already running for this school year', {
        jobId: String(activeJob._id),
        status: activeJob.status,
      })
      return
    }

    const existingDraft = await Schedule.findOne({
      schoolYear: canonicalYear,
      status: 'draft',
    })
      .select('_id')
      .lean()
    if (existingDraft && !replaceExistingDraft) {
      sendResponse(res, 409, false, 'A draft schedule already exists for this school year', {
        scheduleId: String(existingDraft._id),
      })
      return
    }

    const resolvedSeed = Number.isFinite(Number(seed)) ? Math.floor(Number(seed)) >>> 0 : Date.now() >>> 0
    const resolvedIterations = clampInt(
      iterationBudget,
      GENERATION_LIMITS.defaultIterationBudget,
      1,
      GENERATION_LIMITS.maxIterationBudget
    )
    const resolvedTimeBudget = clampInt(
      timeBudgetMs,
      GENERATION_LIMITS.defaultTimeBudgetMs,
      1000,
      GENERATION_LIMITS.maxTimeBudgetMs
    )

    let job
    try {
      job = await GenerationJob.create({
        schoolYear: canonicalYear,
        status: 'queued',
        requestedBy: req.user?.id,
        replaceExistingDraft: !!replaceExistingDraft,
        keepLocked: !!keepLocked,
        seed: resolvedSeed,
        iterationBudget: resolvedIterations,
        timeBudgetMs: resolvedTimeBudget,
        precheck: {
          ok: true,
          errors: 0,
          warnings: data.precheck.warnings.length,
        },
        progress: { phase: 'queued', percent: 0, message: null },
      })
    } catch (error) {
      // The active-job partial unique index rejected a concurrent start.
      if (isDuplicateKeyError(error)) {
        sendResponse(res, 409, false, 'A generation is already running for this school year')
        return
      }
      throw error
    }

    // Fire and forget; the job document tracks progress and outcome.
    void runGenerationJob({
      jobId: String(job._id),
      seed: resolvedSeed,
      iterationBudget: resolvedIterations,
      timeBudgetMs: resolvedTimeBudget,
    })

    sendResponse(res, 202, true, 'Schedule generation started', {
      jobId: String(job._id),
      schoolYear: canonicalYear,
      status: 'queued',
      precheck: { warnings: data.precheck.warnings.length },
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error starting schedule generation', null, error)
  }
}

/**
 * GET /api/schedule/generation-jobs/:id
 * Roles: admin, coordinator
 */
export const getGenerationJob = async (req: Request, res: Response): Promise<void> => {
  try {
    const job = await GenerationJob.findById(req.params.id).lean()
    if (!job) {
      sendResponse(res, 404, false, 'Generation job not found')
      return
    }

    sendResponse(res, 200, true, 'Generation job fetched', {
      jobId: String(job._id),
      schoolYear: job.schoolYear,
      status: job.status,
      progress: job.progress,
      precheck: job.precheck,
      result: job.result,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching generation job', null, error)
  }
}

/**
 * GET /api/schedule/generation-jobs?schoolYear=YYYY-YYYY&limit=20
 * Roles: admin, coordinator
 */
export const listGenerationJobs = async (req: Request, res: Response): Promise<void> => {
  const { schoolYear } = req.query
  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }

  try {
    const canonicalYear = normalizeYear(schoolYear)
    const limit = clampInt(req.query.limit, 20, 1, 100)

    const jobs = await GenerationJob.find({ schoolYear: canonicalYear })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean()

    sendResponse(
      res,
      200,
      true,
      'Generation jobs fetched',
      jobs.map((job: any) => ({
        jobId: String(job._id),
        schoolYear: job.schoolYear,
        status: job.status,
        progress: job.progress,
        precheck: job.precheck,
        result: job.result,
        error: job.error,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        createdAt: job.createdAt,
      }))
    )
  } catch (error) {
    sendResponse(res, 500, false, 'Server error listing generation jobs', null, error)
  }
}
