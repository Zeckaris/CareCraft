import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { BadgeCriteria } from '../models/badgeCriteria.model.js'
import { BadgeDefinition } from '../models/badgeDefinition.model.js'
import { AttributeCategory } from '../models/attributeCategory.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import {
  AUTOMATIC_CRITERIA_TYPES,
  BADGE_CRITERIA_TYPE_LIST,
  isAutomaticCriteriaType,
  isBadgeCriteriaScope,
  isBadgeCriteriaType,
  type BadgeCriteriaScope,
  type BadgeCriteriaType,
} from '../badges/criteriaRegistry.js'

interface NormalizedCriteria {
  type: BadgeCriteriaType
  attributeCategoryId: mongoose.Types.ObjectId | null
  minScore: number | null
  minPercentage: number | null
  minRecordedSchoolDays: number | null
  minLockedWeightPercentage: number | null
  minEvaluationCount: number | null
  scope: BadgeCriteriaScope | null
  description: string
}

type ValidationResult =
  | { value: NormalizedCriteria; error?: undefined }
  | { value?: undefined; error: { status: number; message: string } }

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === ''

function parseNullableObjectId(
  value: unknown,
  field: string
): { id: mongoose.Types.ObjectId | null; error?: string } {
  if (isBlank(value)) return { id: null }
  if (!mongoose.isValidObjectId(value)) {
    return { id: null, error: `Invalid ${field}` }
  }
  return { id: new mongoose.Types.ObjectId(String(value)) }
}

function parseNullableNumber(
  value: unknown,
  field: string
): { number: number | null; error?: string } {
  if (isBlank(value)) return { number: null }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return { number: null, error: `${field} must be a number` }
  }
  return { number: value }
}

function parseNullableInteger(
  value: unknown,
  field: string
): { integer: number | null; error?: string } {
  if (isBlank(value)) return { integer: null }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { integer: null, error: `${field} must be an integer` }
  }
  return { integer: value }
}

async function validateCriteriaValues(raw: {
  type: unknown
  attributeCategoryId: unknown
  minScore: unknown
  minPercentage: unknown
  minRecordedSchoolDays: unknown
  minLockedWeightPercentage: unknown
  minEvaluationCount: unknown
  scope: unknown
  description: unknown
}): Promise<ValidationResult> {
  if (!isBadgeCriteriaType(raw.type)) {
    return {
      error: {
        status: 400,
        message: `Invalid type: must be one of ${BADGE_CRITERIA_TYPE_LIST}`,
      },
    }
  }
  const type = raw.type

  const category = parseNullableObjectId(
    raw.attributeCategoryId,
    'attributeCategoryId'
  )
  if (category.error) {
    return { error: { status: 400, message: category.error } }
  }

  const minScore = parseNullableNumber(raw.minScore, 'minScore')
  if (minScore.error) {
    return { error: { status: 400, message: minScore.error } }
  }

  const minPercentage = parseNullableNumber(raw.minPercentage, 'minPercentage')
  if (minPercentage.error) {
    return { error: { status: 400, message: minPercentage.error } }
  }

  const minRecordedSchoolDays = parseNullableInteger(
    raw.minRecordedSchoolDays,
    'minRecordedSchoolDays'
  )
  if (minRecordedSchoolDays.error) {
    return { error: { status: 400, message: minRecordedSchoolDays.error } }
  }

  const minLockedWeightPercentage = parseNullableNumber(
    raw.minLockedWeightPercentage,
    'minLockedWeightPercentage'
  )
  if (minLockedWeightPercentage.error) {
    return { error: { status: 400, message: minLockedWeightPercentage.error } }
  }

  const minEvaluationCount = parseNullableInteger(
    raw.minEvaluationCount,
    'minEvaluationCount'
  )
  if (minEvaluationCount.error) {
    return { error: { status: 400, message: minEvaluationCount.error } }
  }

  let scope: BadgeCriteriaScope | null = null
  if (!isBlank(raw.scope)) {
    if (!isBadgeCriteriaScope(raw.scope)) {
      return {
        error: { status: 400, message: 'Invalid scope: must be term or year' },
      }
    }
    scope = raw.scope
  }

  const description =
    typeof raw.description === 'string' ? raw.description.trim() : ''

  if (type === 'attributeAverage') {
    if (minScore.number === null) {
      return {
        error: {
          status: 400,
          message: 'attributeAverage requires minScore',
        },
      }
    }
    if (scope === null) {
      return {
        error: {
          status: 400,
          message: 'attributeAverage requires scope (term or year)',
        },
      }
    }
    if (minPercentage.number !== null) {
      return {
        error: {
          status: 400,
          message: 'minPercentage is only valid for attendanceRate and academicAverage',
        },
      }
    }
    if (minEvaluationCount.integer === null) {
      return {
        error: {
          status: 400,
          message: 'attributeAverage requires minEvaluationCount',
        },
      }
    }
    if (
      minEvaluationCount.integer < 1 ||
      minEvaluationCount.integer > 1000
    ) {
      return {
        error: {
          status: 400,
          message: 'minEvaluationCount must be between 1 and 1000',
        },
      }
    }
    if (
      minRecordedSchoolDays.integer !== null ||
      minLockedWeightPercentage.number !== null
    ) {
      return {
        error: {
          status: 400,
          message:
            'attributeAverage does not accept minRecordedSchoolDays or minLockedWeightPercentage',
        },
      }
    }

    if (category.id) {
      const attributeCategory = await AttributeCategory.findById(category.id)
      if (!attributeCategory) {
        return {
          error: { status: 404, message: 'AttributeCategory not found' },
        }
      }
      if (
        minScore.number < attributeCategory.minScore ||
        minScore.number > attributeCategory.maxScore
      ) {
        return {
          error: {
            status: 400,
            message: `minScore must be between ${attributeCategory.minScore} and ${attributeCategory.maxScore}`,
          },
        }
      }
    } else {
      // Global criteria average across every category. The score must be
      // attainable on the configured scale(s).
      const categories = await AttributeCategory.find()
        .select('minScore maxScore')
        .lean()
      if (categories.length === 0) {
        return {
          error: {
            status: 400,
            message:
              'No attribute categories exist. Create an attribute category before using a global attributeAverage.',
          },
        }
      }
      const scaleMin = Math.min(...categories.map((c) => c.minScore))
      const scaleMax = Math.max(...categories.map((c) => c.maxScore))
      if (minScore.number < scaleMin || minScore.number > scaleMax) {
        return {
          error: {
            status: 400,
            message: `minScore must be between ${scaleMin} and ${scaleMax}`,
          },
        }
      }
    }

    return {
      value: {
        type,
        attributeCategoryId: category.id ?? null,
        minScore: minScore.number,
        minPercentage: null,
        minRecordedSchoolDays: null,
        minLockedWeightPercentage: null,
        minEvaluationCount: minEvaluationCount.integer,
        scope,
        description,
      },
    }
  }

  if (type === 'attendanceRate' || type === 'academicAverage') {
    if (minPercentage.number === null) {
      return {
        error: {
          status: 400,
          message: `${type} requires minPercentage`,
        },
      }
    }
    if (minPercentage.number < 0 || minPercentage.number > 100) {
      return {
        error: {
          status: 400,
          message: 'minPercentage must be between 0 and 100',
        },
      }
    }
    if (scope === null) {
      return {
        error: {
          status: 400,
          message: `${type} requires scope (term or year)`,
        },
      }
    }
    if (category.id !== null || minScore.number !== null) {
      return {
        error: {
          status: 400,
          message: `${type} does not accept attributeCategoryId or minScore`,
        },
      }
    }

    if (type === 'attendanceRate') {
      if (minRecordedSchoolDays.integer === null) {
        return {
          error: {
            status: 400,
            message: 'attendanceRate requires minRecordedSchoolDays',
          },
        }
      }
      if (
        minRecordedSchoolDays.integer < 1 ||
        minRecordedSchoolDays.integer > 366
      ) {
        return {
          error: {
            status: 400,
            message: 'minRecordedSchoolDays must be between 1 and 366',
          },
        }
      }
      if (
        minLockedWeightPercentage.number !== null ||
        minEvaluationCount.integer !== null
      ) {
        return {
          error: {
            status: 400,
            message:
              'attendanceRate does not accept minLockedWeightPercentage or minEvaluationCount',
          },
        }
      }
    } else {
      if (minLockedWeightPercentage.number === null) {
        return {
          error: {
            status: 400,
            message: 'academicAverage requires minLockedWeightPercentage',
          },
        }
      }
      if (
        minLockedWeightPercentage.number <= 0 ||
        minLockedWeightPercentage.number > 100
      ) {
        return {
          error: {
            status: 400,
            message:
              'minLockedWeightPercentage must be greater than 0 and at most 100',
          },
        }
      }
      if (
        minRecordedSchoolDays.integer !== null ||
        minEvaluationCount.integer !== null
      ) {
        return {
          error: {
            status: 400,
            message:
              'academicAverage does not accept minRecordedSchoolDays or minEvaluationCount',
          },
        }
      }
    }

    return {
      value: {
        type,
        attributeCategoryId: null,
        minScore: null,
        minPercentage: minPercentage.number,
        minRecordedSchoolDays:
          type === 'attendanceRate' ? minRecordedSchoolDays.integer : null,
        minLockedWeightPercentage:
          type === 'academicAverage'
            ? minLockedWeightPercentage.number
            : null,
        minEvaluationCount: null,
        scope,
        description,
      },
    }
  }

  // custom
  if (!description) {
    return {
      error: { status: 400, message: 'custom type requires a description' },
    }
  }
  if (
    category.id !== null ||
    minScore.number !== null ||
    minPercentage.number !== null ||
    minRecordedSchoolDays.integer !== null ||
    minLockedWeightPercentage.number !== null ||
    minEvaluationCount.integer !== null ||
    scope !== null
  ) {
    return {
      error: {
        status: 400,
        message:
          'custom type does not accept attributeCategoryId, minScore, minPercentage, minRecordedSchoolDays, minLockedWeightPercentage, minEvaluationCount, or scope',
      },
    }
  }

  return {
    value: {
      type,
      attributeCategoryId: null,
      minScore: null,
      minPercentage: null,
      minRecordedSchoolDays: null,
      minLockedWeightPercentage: null,
      minEvaluationCount: null,
      scope: null,
      description,
    },
  }
}

// ─── list ────────────────────────────────────────────────────────────────────

export const getAllBadgeCriteria = async (
  req: Request,
  res: Response
): Promise<void> => {
  const {
    page = 1,
    limit = 10,
    badgeDefinitionId,
    type,
    attributeCategoryId,
    scope,
  } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter: any = {}
  if (badgeDefinitionId) {
    if (!mongoose.isValidObjectId(badgeDefinitionId)) {
      sendResponse(res, 400, false, 'Invalid badgeDefinitionId')
      return
    }
    const badgeDefinition = await BadgeDefinition.findById(badgeDefinitionId)
    if (!badgeDefinition) {
      sendResponse(res, 404, false, 'BadgeDefinition not found')
      return
    }
    filter.badgeDefinitionId = badgeDefinitionId
  }
  if (type) {
    if (!isBadgeCriteriaType(type)) {
      sendResponse(
        res,
        400,
        false,
        `Invalid type: must be one of ${BADGE_CRITERIA_TYPE_LIST}`
      )
      return
    }
    filter.type = type
  }
  if (attributeCategoryId) {
    if (!mongoose.isValidObjectId(attributeCategoryId)) {
      sendResponse(res, 400, false, 'Invalid attributeCategoryId')
      return
    }
    const attributeCategory = await AttributeCategory.findById(attributeCategoryId)
    if (!attributeCategory) {
      sendResponse(res, 404, false, 'AttributeCategory not found')
      return
    }
    filter.attributeCategoryId = attributeCategoryId
  }
  if (scope) {
    if (!isBadgeCriteriaScope(scope)) {
      sendResponse(res, 400, false, 'Invalid scope: must be term or year')
      return
    }
    filter.scope = scope
  }

  try {
    const criteria = await BadgeCriteria.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean()
    const total = await BadgeCriteria.countDocuments(filter)

    sendResponse(res, 200, true, 'Badge criteria fetched successfully', criteria, null, {
      total,
      page: Number(page),
      limit: Number(limit),
    })
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error fetching badge criteria: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── get by id ───────────────────────────────────────────────────────────────

export const getBadgeCriteriaById = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge criteria ID')
    return
  }

  try {
    const criteria = await BadgeCriteria.findById(id).lean()
    if (!criteria) {
      sendResponse(res, 404, false, 'BadgeCriteria not found')
      return
    }
    sendResponse(res, 200, true, 'Badge criteria fetched successfully', criteria)
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error fetching badge criteria: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── create ──────────────────────────────────────────────────────────────────

export const createBadgeCriteria = async (
  req: Request,
  res: Response
): Promise<void> => {
  const {
    badgeDefinitionId,
    type,
    attributeCategoryId,
    minScore,
    minPercentage,
    minRecordedSchoolDays,
    minLockedWeightPercentage,
    minEvaluationCount,
    scope,
    description,
  } = req.body

  if (!badgeDefinitionId || !type) {
    sendResponse(res, 400, false, 'Missing required fields: badgeDefinitionId or type')
    return
  }
  if (!mongoose.isValidObjectId(badgeDefinitionId)) {
    sendResponse(res, 400, false, 'Invalid badgeDefinitionId')
    return
  }

  const result = await validateCriteriaValues({
    type,
    attributeCategoryId,
    minScore,
    minPercentage,
    minRecordedSchoolDays,
    minLockedWeightPercentage,
    minEvaluationCount,
    scope,
    description,
  })
  if (result.error) {
    sendResponse(res, result.error.status, false, result.error.message)
    return
  }

  try {
    const badgeDefinition = await BadgeDefinition.findById(badgeDefinitionId)
    if (!badgeDefinition) {
      sendResponse(res, 404, false, 'BadgeDefinition not found')
      return
    }

    const criteria = await BadgeCriteria.create({
      badgeDefinitionId,
      ...result.value,
    })

    sendResponse(res, 201, true, 'Badge criteria created successfully', criteria)
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error creating badge criteria: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── update ──────────────────────────────────────────────────────────────────

export const updateBadgeCriteria = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params
  const {
    badgeDefinitionId,
    type,
    attributeCategoryId,
    minScore,
    minPercentage,
    minRecordedSchoolDays,
    minLockedWeightPercentage,
    minEvaluationCount,
    scope,
    description,
  } = req.body

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge criteria ID')
    return
  }

  const hasBadgeDefinitionId = badgeDefinitionId !== undefined
  if (hasBadgeDefinitionId && !mongoose.isValidObjectId(badgeDefinitionId)) {
    sendResponse(res, 400, false, 'Invalid badgeDefinitionId')
    return
  }

  if (
    !hasBadgeDefinitionId &&
    type === undefined &&
    attributeCategoryId === undefined &&
    minScore === undefined &&
    minPercentage === undefined &&
    minRecordedSchoolDays === undefined &&
    minLockedWeightPercentage === undefined &&
    minEvaluationCount === undefined &&
    scope === undefined &&
    description === undefined
  ) {
    sendResponse(
      res,
      400,
      false,
      'At least one field (badgeDefinitionId, type, attributeCategoryId, minScore, minPercentage, minRecordedSchoolDays, minLockedWeightPercentage, minEvaluationCount, scope, description) required'
    )
    return
  }

  try {
    const criteria = await BadgeCriteria.findById(id)
    if (!criteria) {
      sendResponse(res, 404, false, 'BadgeCriteria not found')
      return
    }

    const result = await validateCriteriaValues({
      type: type !== undefined ? type : criteria.type,
      attributeCategoryId:
        attributeCategoryId !== undefined
          ? attributeCategoryId
          : criteria.attributeCategoryId,
      minScore: minScore !== undefined ? minScore : criteria.minScore,
      minPercentage:
        minPercentage !== undefined ? minPercentage : criteria.minPercentage,
      minRecordedSchoolDays:
        minRecordedSchoolDays !== undefined
          ? minRecordedSchoolDays
          : criteria.minRecordedSchoolDays,
      minLockedWeightPercentage:
        minLockedWeightPercentage !== undefined
          ? minLockedWeightPercentage
          : criteria.minLockedWeightPercentage,
      minEvaluationCount:
        minEvaluationCount !== undefined
          ? minEvaluationCount
          : criteria.minEvaluationCount,
      scope: scope !== undefined ? scope : criteria.scope,
      description: description !== undefined ? description : criteria.description,
    })
    if (result.error) {
      sendResponse(res, result.error.status, false, result.error.message)
      return
    }

    const nextBadgeDefinitionId = hasBadgeDefinitionId
      ? String(badgeDefinitionId)
      : String(criteria.badgeDefinitionId)

    const destination = await BadgeDefinition.findById(nextBadgeDefinitionId)
    if (!destination) {
      sendResponse(res, 404, false, 'BadgeDefinition not found')
      return
    }

    if (nextBadgeDefinitionId !== String(criteria.badgeDefinitionId)) {
      const sourceDefinition = await BadgeDefinition.findById(
        criteria.badgeDefinitionId
      )
      if (sourceDefinition?.autoAward) {
        const remainingAutomatic = await BadgeCriteria.countDocuments({
          badgeDefinitionId: criteria.badgeDefinitionId,
          _id: { $ne: criteria._id },
          type: { $in: AUTOMATIC_CRITERIA_TYPES },
        })
        if (remainingAutomatic === 0) {
          sendResponse(
            res,
            400,
            false,
            'Cannot move the last automatic criteria away from an auto-award badge. Disable autoAward first.'
          )
          return
        }
      }
    }

    if (destination.autoAward) {
      const otherAutomatic = await BadgeCriteria.countDocuments({
        badgeDefinitionId: nextBadgeDefinitionId,
        _id: { $ne: criteria._id },
        type: { $in: AUTOMATIC_CRITERIA_TYPES },
      })
      if (
        otherAutomatic === 0 &&
        !isAutomaticCriteriaType(result.value.type)
      ) {
        sendResponse(
          res,
          400,
          false,
          'An auto-award badge must keep at least one automatic criteria. Disable autoAward first.'
        )
        return
      }
    }

    const updated = await BadgeCriteria.findByIdAndUpdate(
      id,
      {
        badgeDefinitionId: nextBadgeDefinitionId,
        ...result.value,
      },
      { new: true }
    ).lean()

    sendResponse(res, 200, true, 'Badge criteria updated successfully', updated)
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error updating badge criteria: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── delete ──────────────────────────────────────────────────────────────────

export const deleteBadgeCriteria = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge criteria ID')
    return
  }

  try {
    const criteria = await BadgeCriteria.findById(id)
    if (!criteria) {
      sendResponse(res, 404, false, 'BadgeCriteria not found')
      return
    }

    const definition = await BadgeDefinition.findById(criteria.badgeDefinitionId)
    if (definition?.autoAward) {
      const remainingAutomatic = await BadgeCriteria.countDocuments({
        badgeDefinitionId: criteria.badgeDefinitionId,
        _id: { $ne: criteria._id },
        type: { $in: AUTOMATIC_CRITERIA_TYPES },
      })
      if (remainingAutomatic === 0) {
        sendResponse(
          res,
          400,
          false,
          'Cannot delete the last automatic criteria of an auto-award badge. Disable autoAward first.'
        )
        return
      }
    }

    await BadgeCriteria.findByIdAndDelete(id)
    sendResponse(res, 200, true, 'Badge criteria deleted successfully')
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error deleting badge criteria: ${(error as Error).message}`,
      null,
      error
    )
  }
}
