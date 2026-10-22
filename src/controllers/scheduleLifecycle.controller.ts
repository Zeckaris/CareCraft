import { Request, Response } from 'express'
import { Types } from 'mongoose'
import { Schedule } from '../models/schedule.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { AuthRequest } from '../middlewares/auth.middleware.js'
import { EditError } from '../service/scheduleEdit.service.js'
import {
  cloneSchedule,
  computeDrift,
  publishSchedule,
} from '../service/scheduleLifecycle.service.js'

function handleError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof EditError) {
    sendResponse(res, error.statusCode, false, error.message, error.payload)
    return
  }
  sendResponse(res, 500, false, fallback, null, error)
}

/**
 * POST /api/schedule/schedules/:id/publish
 * Roles: admin, coordinator
 *
 * Re-runs the validator and drift check against current data. Blocks on hard
 * violations or drift. Blocks on unplaced lessons unless `allowUnplaced` is set
 * (the override is recorded on the schedule). Body: { allowUnplaced? }
 */
export const publishScheduleController = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params
  const { allowUnplaced } = req.body ?? {}
  try {
    const result = await publishSchedule(id, {
      allowUnplaced: !!allowUnplaced,
      userId: req.user?.id,
    })
    sendResponse(res, 200, true, 'Schedule published', result)
  } catch (error) {
    handleError(res, error, 'Server error publishing schedule')
  }
}

/**
 * POST /api/schedule/schedules/:id/clone
 * Roles: admin, coordinator
 *
 * Copies a published/archived schedule into a new draft. Refuses (409) when a
 * draft already exists for the year unless `replaceExistingDraft` is set.
 */
export const cloneScheduleController = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params
  const { replaceExistingDraft } = req.body ?? {}
  try {
    const schedule = await cloneSchedule(id, {
      replaceExistingDraft: !!replaceExistingDraft,
      userId: req.user?.id,
    })
    sendResponse(res, 201, true, 'Schedule cloned', {
      scheduleId: String(schedule._id),
      schoolYear: schedule.schoolYear,
      status: schedule.status,
      entryCount: schedule.entryCount,
      clonedFrom: id,
      version: schedule.version ?? 0,
    })
  } catch (error) {
    handleError(res, error, 'Server error cloning schedule')
  }
}

/**
 * GET /api/schedule/schedules/:id/drift
 * Roles: admin, coordinator
 *
 * Structured drift report comparing the schedule's stored fingerprint/snapshot
 * to the current settings/requirements/assignments. Never modifies entries.
 */
export const getScheduleDrift = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!Types.ObjectId.isValid(id)) {
    sendResponse(res, 404, false, 'Schedule not found')
    return
  }
  try {
    const schedule = await Schedule.findById(id).lean()
    if (!schedule) {
      sendResponse(res, 404, false, 'Schedule not found')
      return
    }
    const report = await computeDrift(schedule)
    sendResponse(res, 200, true, 'Schedule drift report', report)
  } catch (error) {
    sendResponse(res, 500, false, 'Server error computing schedule drift', null, error)
  }
}
