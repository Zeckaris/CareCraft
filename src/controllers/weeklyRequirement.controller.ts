import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { WeeklyPeriodRequirement } from '../models/weeklyPeriodRequirement.model.js'
import { ScheduleSetting } from '../models/scheduleSetting.model.js'
import { Grade } from '../models/grade.model.js'
import { Subject } from '../models/subject.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'
import { isValidSchoolYear } from '../utils/schoolYear.util.js'
import {
  DOUBLE_PERIOD_OPTIONS,
  deriveScheduleSetting,
  pickScheduleSettingData,
  type DoublePeriodOption,
} from '../utils/scheduleSetting.util.js'

// ─── helpers ────────────────────────────────────────────────────────────────

interface NormalizedItem {
  subjectId: string
  periodsPerWeek: number
  doublePeriod: DoublePeriodOption
}

/** Resolves the weekly slot count from the year's settings (null when unset). */
const resolveWeeklySlotCount = async (canonicalYear: string): Promise<number | null> => {
  const setting = await ScheduleSetting.findOne({
    schoolYear: { $in: getYearVariants(canonicalYear) },
  }).lean()
  if (!setting) return null
  return deriveScheduleSetting(pickScheduleSettingData(setting)).weeklySlotCount
}

/** Builds the list view for a grade including running totals and status. */
const buildRequirementList = async (canonicalYear: string, grade: any) => {
  const weeklySlotCount = await resolveWeeklySlotCount(canonicalYear)

  const requirements = await WeeklyPeriodRequirement.find({
    schoolYear: { $in: getYearVariants(canonicalYear) },
    gradeId: grade._id,
  })
    .populate('subjectId', 'name description')
    .sort({ createdAt: 1 })
    .lean()

  let running = 0
  const items = requirements.map((r: any) => {
    running += r.periodsPerWeek
    return {
      requirementId: String(r._id),
      subjectId: String(r.subjectId?._id ?? r.subjectId),
      subjectName: r.subjectId?.name ?? null,
      periodsPerWeek: r.periodsPerWeek,
      doublePeriod: r.doublePeriod,
      runningTotal: running,
    }
  })

  const totalPeriods = running
  const remainingPeriods = weeklySlotCount === null ? null : weeklySlotCount - totalPeriods
  const status =
    weeklySlotCount === null
      ? null
      : totalPeriods > weeklySlotCount
        ? 'over'
        : totalPeriods < weeklySlotCount
          ? 'under'
          : 'exact'

  return {
    schoolYear: canonicalYear,
    gradeId: String(grade._id),
    grade: { _id: grade._id, level: grade.level, description: grade.description ?? null },
    weeklySlotCount,
    items,
    totalPeriods,
    remainingPeriods,
    status,
  }
}

/** Validates the items array of a bulk-upsert payload. */
const normalizeItems = (
  rawItems: unknown
): { items: NormalizedItem[]; error: string | null } => {
  if (rawItems === undefined || rawItems === null) return { items: [], error: null }
  if (!Array.isArray(rawItems)) return { items: [], error: 'items must be an array' }

  const seen = new Set<string>()
  const items: NormalizedItem[] = []

  for (let i = 0; i < rawItems.length; i++) {
    const it = (rawItems[i] ?? {}) as any
    if (!it.subjectId || !mongoose.isValidObjectId(it.subjectId)) {
      return { items: [], error: `items[${i}].subjectId is not a valid id` }
    }
    const subjectId = String(it.subjectId)
    if (seen.has(subjectId)) {
      return { items: [], error: `items contains a duplicate subjectId: ${subjectId}` }
    }
    seen.add(subjectId)

    const periodsPerWeek = Number(it.periodsPerWeek)
    if (!Number.isInteger(periodsPerWeek) || periodsPerWeek <= 0) {
      return { items: [], error: `items[${i}].periodsPerWeek must be a positive integer` }
    }

    const doublePeriod = (it.doublePeriod ?? 'none') as DoublePeriodOption
    if (!DOUBLE_PERIOD_OPTIONS.includes(doublePeriod)) {
      return {
        items: [],
        error: `items[${i}].doublePeriod must be one of ${DOUBLE_PERIOD_OPTIONS.join(', ')}`,
      }
    }

    items.push({ subjectId, periodsPerWeek, doublePeriod })
  }

  return { items, error: null }
}

// ─── GET list for a grade ───────────────────────────────────────────────────

/**
 * GET /api/schedule/requirements?schoolYear=YYYY-YYYY&gradeId=...
 * Roles: admin, coordinator
 *
 * Returns the grade's requirements in creation order with a running total,
 * the weekly slot count, the remaining periods and an under/exact/over status.
 */
export const listWeeklyRequirements = async (req: Request, res: Response): Promise<void> => {
  const { schoolYear, gradeId } = req.query

  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }
  if (!gradeId || !mongoose.isValidObjectId(gradeId as string)) {
    sendResponse(res, 400, false, 'Valid gradeId query parameter is required')
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

    const grade = await Grade.findById(gradeId)
    if (!grade) {
      sendResponse(res, 404, false, 'Grade not found')
      return
    }

    const canonicalYear = normalizeYear(schoolYear)
    const data = await buildRequirementList(canonicalYear, grade)
    sendResponse(res, 200, true, 'Weekly period requirements fetched successfully', data)
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching weekly period requirements', null, error)
  }
}

// ─── PUT bulk create-or-update for a grade ──────────────────────────────────

/**
 * PUT /api/schedule/requirements
 * Roles: admin, coordinator
 *
 * Body: {
 *   schoolYear, gradeId,
 *   items: [{ subjectId, periodsPerWeek, doublePeriod? }]
 * }
 *
 * Create-or-update only (subjects omitted from `items` are left untouched;
 * use DELETE to remove one). Saving is never blocked when the grade total is
 * over or under the weekly slots — the response reports the totals and status.
 */
export const bulkUpsertWeeklyRequirements = async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {}
  const { schoolYear, gradeId } = body

  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required field: schoolYear')
    return
  }
  if (!gradeId || !mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Valid gradeId is required')
    return
  }

  const { items, error: itemError } = normalizeItems(body.items)
  if (itemError) {
    sendResponse(res, 400, false, itemError)
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

    const grade = await Grade.findById(gradeId)
    if (!grade) {
      sendResponse(res, 404, false, 'Grade not found')
      return
    }

    if (items.length > 0) {
      const found = await Subject.find({ _id: { $in: items.map((i) => i.subjectId) } })
        .select('_id')
        .lean()
      const foundIds = new Set(found.map((s) => String(s._id)))
      const missing = items.filter((i) => !foundIds.has(i.subjectId)).map((i) => i.subjectId)
      if (missing.length > 0) {
        sendResponse(res, 400, false, `Subject(s) not found: ${missing.join(', ')}`)
        return
      }
    }

    const canonicalYear = normalizeYear(schoolYear)
    const variants = getYearVariants(canonicalYear)

    if (items.length > 0) {
      await WeeklyPeriodRequirement.bulkWrite(
        items.map((it) => ({
          updateOne: {
            filter: {
              schoolYear: { $in: variants },
              gradeId,
              subjectId: it.subjectId,
            },
            update: {
              $set: { periodsPerWeek: it.periodsPerWeek, doublePeriod: it.doublePeriod },
              $setOnInsert: { schoolYear: canonicalYear },
            },
            upsert: true,
          },
        })) as any[],
        { ordered: false }
      )
    }

    const data = await buildRequirementList(canonicalYear, grade)
    sendResponse(res, 200, true, 'Weekly period requirements saved successfully', data)
  } catch (error: any) {
    if (error?.code === 11000) {
      sendResponse(
        res,
        409,
        false,
        'Conflict: a weekly period requirement already exists for this grade and subject'
      )
      return
    }
    sendResponse(res, 500, false, 'Server error saving weekly period requirements', null, error)
  }
}

// ─── DELETE one ─────────────────────────────────────────────────────────────

/**
 * DELETE /api/schedule/requirements/:id
 * Roles: admin, coordinator
 */
export const deleteWeeklyRequirement = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid requirement ID')
    return
  }

  try {
    const deleted = await WeeklyPeriodRequirement.findByIdAndDelete(id)
    if (!deleted) {
      sendResponse(res, 404, false, 'Weekly period requirement not found')
      return
    }
    sendResponse(res, 200, true, 'Weekly period requirement deleted successfully')
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting weekly period requirement', null, error)
  }
}

// ─── COPY to another grade ──────────────────────────────────────────────────

/**
 * POST /api/schedule/requirements/copy
 * Roles: admin, coordinator
 *
 * Body: { schoolYear, fromGradeId, toGradeId, overwrite? }
 *
 * Without overwrite, subjects already present on the target grade are skipped.
 * With overwrite: true the target's values are replaced by the source's values
 * for every shared subject (target-only subjects are left in place).
 */
export const copyWeeklyRequirements = async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {}
  const { schoolYear, fromGradeId, toGradeId, overwrite } = body

  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required field: schoolYear')
    return
  }
  if (!fromGradeId || !mongoose.isValidObjectId(fromGradeId)) {
    sendResponse(res, 400, false, 'Valid fromGradeId is required')
    return
  }
  if (!toGradeId || !mongoose.isValidObjectId(toGradeId)) {
    sendResponse(res, 400, false, 'Valid toGradeId is required')
    return
  }
  if (String(fromGradeId) === String(toGradeId)) {
    sendResponse(res, 400, false, 'fromGradeId and toGradeId must be different')
    return
  }

  const doOverwrite = overwrite === true || overwrite === 'true'

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

    const [fromGrade, toGrade] = await Promise.all([
      Grade.findById(fromGradeId),
      Grade.findById(toGradeId),
    ])
    if (!fromGrade) {
      sendResponse(res, 404, false, 'Source grade not found')
      return
    }
    if (!toGrade) {
      sendResponse(res, 404, false, 'Target grade not found')
      return
    }

    const canonicalYear = normalizeYear(schoolYear)
    const variants = getYearVariants(canonicalYear)

    const [source, target] = await Promise.all([
      WeeklyPeriodRequirement.find({
        schoolYear: { $in: variants },
        gradeId: fromGradeId,
      }).lean(),
      WeeklyPeriodRequirement.find({
        schoolYear: { $in: variants },
        gradeId: toGradeId,
      }).lean(),
    ])

    if (source.length === 0) {
      sendResponse(res, 400, false, 'Source grade has no weekly period requirements to copy')
      return
    }

    const existingBySubject = new Map<string, any>(target.map((r) => [String(r.subjectId), r]))

    let created = 0
    let overwritten = 0
    let skipped = 0
    const ops: any[] = []

    for (const src of source as any[]) {
      const key = String(src.subjectId)
      const existing = existingBySubject.get(key)

      if (existing) {
        if (doOverwrite) {
          overwritten += 1
          ops.push({
            updateOne: {
              filter: { _id: existing._id },
              update: {
                $set: { periodsPerWeek: src.periodsPerWeek, doublePeriod: src.doublePeriod },
              },
            },
          })
        } else {
          skipped += 1
        }
      } else {
        created += 1
        ops.push({
          updateOne: {
            filter: { schoolYear: { $in: variants }, gradeId: toGradeId, subjectId: src.subjectId },
            update: {
              $set: { periodsPerWeek: src.periodsPerWeek, doublePeriod: src.doublePeriod },
              $setOnInsert: { schoolYear: canonicalYear },
            },
            upsert: true,
          },
        })
      }
    }

    if (ops.length > 0) await WeeklyPeriodRequirement.bulkWrite(ops, { ordered: false })

    const totalTargetAfter = await WeeklyPeriodRequirement.countDocuments({
      schoolYear: { $in: variants },
      gradeId: toGradeId,
    })

    sendResponse(res, 200, true, 'Weekly period requirements copied successfully', {
      schoolYear: canonicalYear,
      fromGradeId: String(fromGradeId),
      toGradeId: String(toGradeId),
      overwrite: doOverwrite,
      copied: created,
      overwritten,
      skipped,
      totalTargetAfter,
    })
  } catch (error: any) {
    if (error?.code === 11000) {
      sendResponse(
        res,
        409,
        false,
        'Conflict: a weekly period requirement already exists for this grade and subject'
      )
      return
    }
    sendResponse(res, 500, false, 'Server error copying weekly period requirements', null, error)
  }
}
