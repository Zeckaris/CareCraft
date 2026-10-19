import { Request, Response } from 'express'
import { ScheduleSetting } from '../models/scheduleSetting.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'
import { isValidSchoolYear } from '../utils/schoolYear.util.js'
import {
  DEFAULT_ENABLED_DAYS,
  deriveScheduleSetting,
  pickScheduleSettingData,
  validateScheduleSettingData,
} from '../utils/scheduleSetting.util.js'

// ─── helpers ────────────────────────────────────────────────────────────────

const buildResponseData = (setting: any) => ({
  settings: setting,
  derived: deriveScheduleSetting(pickScheduleSettingData(setting)),
})

// ─── GET ────────────────────────────────────────────────────────────────────

/**
 * GET /api/schedule/settings?schoolYear=YYYY-YYYY
 * Roles: admin, coordinator
 *
 * Returns the stored settings together with the derived values (period times,
 * finish time, period groups, weekly slots, per-day teaching cap). When no
 * settings exist yet the endpoint still returns 200 with `settings: null`.
 */
export const getScheduleSettings = async (req: Request, res: Response): Promise<void> => {
  const { schoolYear } = req.query
  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }

  try {
    if (!(await isValidSchoolYear(schoolYear))) {
      sendResponse(
        res,
        400,
        false,
        `schoolYear "${schoolYear}" does not match any academic calendar`
      )
      return
    }
    const canonicalYear = normalizeYear(schoolYear)
    const setting = await ScheduleSetting.findOne({
      schoolYear: { $in: getYearVariants(canonicalYear) },
    }).lean()

    if (!setting) {
      sendResponse(res, 200, true, `No schedule settings configured for ${canonicalYear}`, {
        settings: null,
        derived: null,
      })
      return
    }

    sendResponse(
      res,
      200,
      true,
      'Schedule settings fetched successfully',
      buildResponseData(setting)
    )
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching schedule settings', null, error)
  }
}

// ─── PUT (create-or-update) ─────────────────────────────────────────────────

/**
 * PUT /api/schedule/settings
 * Roles: admin, coordinator
 *
 * Body: {
 *   schoolYear,
 *   enabledDays?,            // defaults to Monday–Friday
 *   bellSchedule,            // { startTime, blocks: [{ type, durationMinutes, label? }] }
 *   saturdayBellSchedule?,   // same shape, optional
 *   minimumFreePeriodsPerDay?, maximumWeeklyTaughtPeriods?, maximumConsecutivePeriods?
 * }
 *
 * Settings can be edited freely while no schedule exists — there is no locking
 * in Phase 1.
 */
export const upsertScheduleSettings = async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {}
  const { schoolYear } = body

  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required field: schoolYear')
    return
  }

  const validationErrors = validateScheduleSettingData(body)
  if (validationErrors.length > 0) {
    sendResponse(res, 400, false, validationErrors.join('; '))
    return
  }

  try {
    if (!(await isValidSchoolYear(schoolYear))) {
      sendResponse(
        res,
        400,
        false,
        `schoolYear "${schoolYear}" does not match any academic calendar`
      )
      return
    }

    const canonicalYear = normalizeYear(schoolYear)
    const payload = {
      schoolYear: canonicalYear,
      enabledDays: body.enabledDays ?? DEFAULT_ENABLED_DAYS,
      bellSchedule: body.bellSchedule,
      saturdayBellSchedule: body.saturdayBellSchedule ?? null,
      minimumFreePeriodsPerDay:
        body.minimumFreePeriodsPerDay === undefined ? 1 : body.minimumFreePeriodsPerDay,
      maximumWeeklyTaughtPeriods:
        body.maximumWeeklyTaughtPeriods === undefined ? null : body.maximumWeeklyTaughtPeriods,
      maximumConsecutivePeriods:
        body.maximumConsecutivePeriods === undefined ? null : body.maximumConsecutivePeriods,
    }

    const existing = await ScheduleSetting.findOne({
      schoolYear: { $in: getYearVariants(canonicalYear) },
    })

    let setting
    if (existing) {
      existing.set(payload)
      setting = await existing.save()
    } else {
      setting = await ScheduleSetting.create(payload)
    }

    sendResponse(
      res,
      existing ? 200 : 201,
      true,
      existing
        ? 'Schedule settings updated successfully'
        : 'Schedule settings created successfully',
      buildResponseData(setting)
    )
  } catch (error: any) {
    if (error?.code === 11000) {
      sendResponse(
        res,
        409,
        false,
        'Conflict: schedule settings already exist for this school year'
      )
      return
    }
    sendResponse(res, 500, false, 'Server error saving schedule settings', null, error)
  }
}
