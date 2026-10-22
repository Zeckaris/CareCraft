import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { BadgeDefinition } from '../models/badgeDefinition.model.js'
import { BadgeCriteria } from '../models/badgeCriteria.model.js'
import { StudentBadge } from '../models/studentBadge.model.js'
import { AttributeCategory } from '../models/attributeCategory.model.js'
import { Grade } from '../models/grade.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { uploadToCloudinary, deleteFromCloudinary } from '../utils/cloudinary.util.js'
import { AUTOMATIC_CRITERIA_TYPES } from '../badges/criteriaRegistry.js'
import { enqueueBadgeEvaluationForBadge } from '../service/badgeEvaluationQueue.service.js'

interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    role: 'admin' | 'teacher' | 'parent' | 'student' | 'coordinator'
  }
  file?: Express.Multer.File
}

const CRITERIA_POPULATE_FIELDS =
  'badgeDefinitionId type attributeCategoryId minScore minPercentage minRecordedSchoolDays minLockedWeightPercentage minEvaluationCount subjectId mode minDays minPoints scope description createdAt'

const HOW_TO_EARN_MAX_LENGTH = 500

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseHowToEarn(
  value: unknown
): { value?: string; error?: string } {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'string') {
    return { error: 'howToEarn must be a string' }
  }
  const trimmed = value.trim()
  if (trimmed.length > HOW_TO_EARN_MAX_LENGTH) {
    return {
      error: `howToEarn must be at most ${HOW_TO_EARN_MAX_LENGTH} characters`,
    }
  }
  return { value: trimmed }
}

function parseStringArray(value: unknown): string[] | null {
  if (value === undefined || value === null || value === '') return []
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (!Array.isArray(parsed)) return null
        return parsed.map(String)
      } catch {
        return null
      }
    }
    return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean)
  }
  return null
}

function parseBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return null
}

function parseLevel(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}

async function resolveEligibleGrades(
  raw: unknown
): Promise<{ ids?: mongoose.Types.ObjectId[]; error?: string }> {
  const values = parseStringArray(raw)
  if (values === null) return { error: 'eligibleGrades must be an array of grade IDs' }

  const ids: mongoose.Types.ObjectId[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!mongoose.isValidObjectId(value)) {
      return { error: `Invalid eligible grade ID: ${value}` }
    }
    if (!seen.has(value)) {
      seen.add(value)
      ids.push(new mongoose.Types.ObjectId(value))
    }
  }

  if (ids.length > 0) {
    const found = await Grade.countDocuments({ _id: { $in: ids } })
    if (found !== ids.length) {
      return { error: 'One or more eligible grade IDs do not exist' }
    }
  }

  return { ids }
}

function sameIdSet(a: string[], b: string[]): boolean {
  const setA = new Set(a)
  const setB = new Set(b)
  if (setA.size !== a.length || setB.size !== b.length) return false
  if (setA.size !== setB.size) return false
  for (const id of setA) {
    if (!setB.has(id)) return false
  }
  return true
}

function deleteIcon(icon: string | undefined | null, label: string) {
  if (!icon) return
  try {
    const urlParts = icon.split('/')
    const filenameWithExt = urlParts[urlParts.length - 1]
    const publicId =
      urlParts.slice(-2, -1)[0] + '/' + filenameWithExt.split('.')[0]
    void deleteFromCloudinary(publicId).catch((error) => {
      console.warn(`Failed to delete Cloudinary ${label} icon:`, error)
    })
  } catch (error) {
    console.warn(`Failed to parse Cloudinary ${label} icon URL:`, error)
  }
}

// ─── list ────────────────────────────────────────────────────────────────────

export const getAllBadgeDefinitions = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { page = 1, limit = 10, name, level, attributeCategoryId, autoAward, eligibleGradeId } =
    req.query
  const skip = (Number(page) - 1) * Number(limit)

  const filter: any = {}
  if (name) filter.name = { $regex: name as string, $options: 'i' }
  if (level) {
    const parsedLevel = parseLevel(level)
    if (parsedLevel === null) {
      sendResponse(res, 400, false, 'Invalid level')
      return
    }
    filter.level = parsedLevel
  }
  if (autoAward !== undefined) {
    const parsed = parseBoolean(autoAward)
    if (parsed === null || parsed === undefined) {
      sendResponse(res, 400, false, 'Invalid autoAward: must be true or false')
      return
    }
    filter.autoAward = parsed
  }
  if (eligibleGradeId) {
    if (!mongoose.isValidObjectId(eligibleGradeId)) {
      sendResponse(res, 400, false, 'Invalid eligibleGradeId')
      return
    }
    const grade = await Grade.findById(eligibleGradeId)
    if (!grade) {
      sendResponse(res, 404, false, 'Grade not found')
      return
    }
    // Empty eligibleGrades means "no grade eligible yet", so it must not match.
    filter.eligibleGrades = new mongoose.Types.ObjectId(String(eligibleGradeId))
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
    const criteria = await BadgeCriteria.find({
      $or: [
        { attributeCategoryId },
        { type: 'attributeAverage', attributeCategoryId: null },
      ],
    })
      .select('badgeDefinitionId')
      .lean()
    filter._id = {
      $in: criteria.map((c) => c.badgeDefinitionId),
    }
  }

  try {
    const badges = await BadgeDefinition.find(filter)
      .populate('criteria', CRITERIA_POPULATE_FIELDS)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
    const total = await BadgeDefinition.countDocuments(filter)

    sendResponse(res, 200, true, 'Badge definitions fetched successfully', badges, null, {
      total,
      page: Number(page),
      limit: Number(limit),
    })
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error fetching badge definitions: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── get by id ───────────────────────────────────────────────────────────────

export const getBadgeDefinitionById = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge definition ID')
    return
  }

  try {
    const badge = await BadgeDefinition.findById(id)
      .populate('criteria', CRITERIA_POPULATE_FIELDS)
      .populate('eligibleGrades', 'level description')
    if (!badge) {
      sendResponse(res, 404, false, 'BadgeDefinition not found')
      return
    }
    sendResponse(res, 200, true, 'Badge definition fetched successfully', badge)
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error fetching badge definition: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── create ──────────────────────────────────────────────────────────────────

export const createBadgeDefinition = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { name, description, howToEarn, level, criteria, eligibleGrades, autoAward } =
    req.body

  const trimmedName = typeof name === 'string' ? name.trim() : ''
  const trimmedDescription =
    typeof description === 'string' ? description.trim() : ''
  const parsedLevel = parseLevel(level)

  if (!trimmedName || !trimmedDescription || parsedLevel === null) {
    sendResponse(
      res,
      400,
      false,
      'Missing or invalid required fields: name, description, level (positive integer)'
    )
    return
  }

  const parsedHowToEarn = parseHowToEarn(howToEarn)
  if (parsedHowToEarn.error) {
    sendResponse(res, 400, false, parsedHowToEarn.error)
    return
  }

  const createdBy = req.user?.id
  if (!createdBy || !mongoose.isValidObjectId(createdBy)) {
    sendResponse(res, 401, false, 'Authentication error: invalid or missing user')
    return
  }

  const requestedCriteria = parseStringArray(criteria)
  if (requestedCriteria === null) {
    sendResponse(res, 400, false, 'criteria must be an array of criteria IDs')
    return
  }
  if (requestedCriteria.length > 0) {
    sendResponse(
      res,
      400,
      false,
      'Criteria cannot be attached at creation. Create the badge first, then add criteria via /api/badgeCriteria.'
    )
    return
  }

  const parsedAutoAward = parseBoolean(autoAward)
  if (parsedAutoAward === null) {
    sendResponse(res, 400, false, 'autoAward must be true or false')
    return
  }
  if (parsedAutoAward === true) {
    sendResponse(
      res,
      400,
      false,
      'autoAward cannot be enabled before the badge has at least one automatic criteria'
    )
    return
  }

  const gradeResult = await resolveEligibleGrades(eligibleGrades)
  if (gradeResult.error) {
    sendResponse(res, 400, false, gradeResult.error)
    return
  }

  try {
    const existing = await BadgeDefinition.findOne({
      name: trimmedName,
      level: parsedLevel,
    })
    if (existing) {
      sendResponse(
        res,
        400,
        false,
        'Badge definition with this name and level already exists'
      )
      return
    }

    let icon: string | undefined
    if (req.file) {
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        'icons/badges',
        undefined,
        'image'
      )
      icon = uploadResult.url
    }

    const badge = await BadgeDefinition.create({
      name: trimmedName,
      description: trimmedDescription,
      howToEarn: parsedHowToEarn.value ?? '',
      level: parsedLevel,
      eligibleGrades: gradeResult.ids ?? [],
      autoAward: false,
      icon,
      createdBy,
    })

    await enqueueBadgeEvaluationForBadge(String(badge._id))

    const populated = await BadgeDefinition.findById(badge._id)
      .populate('criteria', CRITERIA_POPULATE_FIELDS)
      .populate('eligibleGrades', 'level description')
      .populate('createdBy', 'firstName lastName email role')

    sendResponse(res, 201, true, 'Badge definition created successfully', populated)
  } catch (error: any) {
    if (error?.code === 11000) {
      sendResponse(
        res,
        400,
        false,
        'Badge definition with this name and level already exists'
      )
      return
    }
    sendResponse(
      res,
      500,
      false,
      `Server error creating badge definition: ${error.message}`,
      null,
      error
    )
  }
}

// ─── update ──────────────────────────────────────────────────────────────────

export const updateBadgeDefinition = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge definition ID')
    return
  }

  const { name, description, howToEarn, level, criteria, eligibleGrades, autoAward } =
    req.body

  const hasName = name !== undefined
  const hasDescription = description !== undefined
  const hasHowToEarn = howToEarn !== undefined
  const hasLevel = level !== undefined && level !== '' && level !== null
  const hasCriteria = criteria !== undefined
  const hasEligibleGrades = eligibleGrades !== undefined
  const hasAutoAward = autoAward !== undefined

  if (
    !hasName &&
    !hasDescription &&
    !hasHowToEarn &&
    !hasLevel &&
    !hasCriteria &&
    !hasEligibleGrades &&
    !hasAutoAward &&
    !req.file
  ) {
    sendResponse(
      res,
      400,
      false,
      'At least one field (name, description, howToEarn, level, criteria, eligibleGrades, autoAward, or icon) required'
    )
    return
  }

  try {
    const badge = await BadgeDefinition.findById(id)
    if (!badge) {
      sendResponse(res, 404, false, 'BadgeDefinition not found')
      return
    }

    const trimmedName = hasName ? String(name).trim() : badge.name
    if (!trimmedName) {
      sendResponse(res, 400, false, 'name cannot be empty')
      return
    }

    const trimmedDescription = hasDescription
      ? String(description).trim()
      : badge.description
    if (!trimmedDescription) {
      sendResponse(res, 400, false, 'description cannot be empty')
      return
    }

    let nextHowToEarn = badge.howToEarn ?? ''
    if (hasHowToEarn) {
      const parsedHowToEarn = parseHowToEarn(howToEarn)
      if (parsedHowToEarn.error) {
        sendResponse(res, 400, false, parsedHowToEarn.error)
        return
      }
      nextHowToEarn = parsedHowToEarn.value ?? ''
    }

    let nextLevel = badge.level
    if (hasLevel) {
      const parsedLevel = parseLevel(level)
      if (parsedLevel === null) {
        sendResponse(res, 400, false, 'level must be a positive integer')
        return
      }
      nextLevel = parsedLevel
    }

    if (trimmedName !== badge.name || nextLevel !== badge.level) {
      const existing = await BadgeDefinition.findOne({
        name: trimmedName,
        level: nextLevel,
        _id: { $ne: id },
      })
      if (existing) {
        sendResponse(
          res,
          400,
          false,
          'Badge definition with this name and level already exists'
        )
        return
      }
    }

    // Criteria are owned by BadgeCriteria. Accept only an unchanged set so
    // clients that resubmit the full badge payload keep working.
    if (hasCriteria) {
      const requestedCriteria = parseStringArray(criteria)
      if (requestedCriteria === null) {
        sendResponse(res, 400, false, 'criteria must be an array of criteria IDs')
        return
      }
      const current = await BadgeCriteria.find({ badgeDefinitionId: id })
        .select('_id')
        .lean()
      const currentIds = current.map((c) => String(c._id))
      if (!sameIdSet(currentIds, requestedCriteria.map(String))) {
        sendResponse(
          res,
          400,
          false,
          'criteria cannot be changed here. Add, update, or remove criteria via /api/badgeCriteria.'
        )
        return
      }
    }

    let nextAutoAward = badge.autoAward
    if (hasAutoAward) {
      const parsed = parseBoolean(autoAward)
      if (parsed === null) {
        sendResponse(res, 400, false, 'autoAward must be true or false')
        return
      }
      if (parsed !== undefined) nextAutoAward = parsed
    }
    if (nextAutoAward) {
      const automaticCriteriaCount = await BadgeCriteria.countDocuments({
        badgeDefinitionId: id,
        type: { $in: AUTOMATIC_CRITERIA_TYPES },
      })
      if (automaticCriteriaCount === 0) {
        sendResponse(
          res,
          400,
          false,
          'autoAward requires at least one automatic criterion'
        )
        return
      }
    }

    const updateData: any = {}
    if (trimmedName !== badge.name) updateData.name = trimmedName
    if (trimmedDescription !== badge.description) {
      updateData.description = trimmedDescription
    }
    if (nextHowToEarn !== (badge.howToEarn ?? '')) {
      updateData.howToEarn = nextHowToEarn
    }
    if (nextLevel !== badge.level) updateData.level = nextLevel
    if (nextAutoAward !== badge.autoAward) updateData.autoAward = nextAutoAward

    if (hasEligibleGrades) {
      const gradeResult = await resolveEligibleGrades(eligibleGrades)
      if (gradeResult.error) {
        sendResponse(res, 400, false, gradeResult.error)
        return
      }
      updateData.eligibleGrades = gradeResult.ids ?? []
    }

    if (req.file) {
      deleteIcon(badge.icon, 'old')
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        'icons/badges',
        undefined,
        'image'
      )
      updateData.icon = uploadResult.url
    }

    const updated = await BadgeDefinition.findByIdAndUpdate(id, updateData, {
      new: true,
    })
      .populate('criteria', CRITERIA_POPULATE_FIELDS)
      .populate('eligibleGrades', 'level description')
      .populate('createdBy', 'firstName lastName email role')

    await enqueueBadgeEvaluationForBadge(id)

    sendResponse(res, 200, true, 'Badge definition updated successfully', updated)
  } catch (error: any) {
    if (error?.code === 11000) {
      sendResponse(
        res,
        400,
        false,
        'Badge definition with this name and level already exists'
      )
      return
    }
    sendResponse(
      res,
      500,
      false,
      `Server error updating badge definition: ${error.message}`,
      null,
      error
    )
  }
}

// ─── delete ──────────────────────────────────────────────────────────────────

export const deleteBadgeDefinition = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid badge definition ID')
    return
  }

  try {
    const badge = await BadgeDefinition.findById(id)
    if (!badge) {
      sendResponse(res, 404, false, 'BadgeDefinition not found')
      return
    }

    const studentBadgeCount = await StudentBadge.countDocuments({ badgeId: id })
    const criteriaCount = await BadgeCriteria.countDocuments({
      badgeDefinitionId: id,
    })
    const dependencies: string[] = []
    if (studentBadgeCount > 0) dependencies.push(`${studentBadgeCount} student badge(s)`)
    if (criteriaCount > 0) dependencies.push(`${criteriaCount} badge criteria`)
    if (dependencies.length > 0) {
      sendResponse(
        res,
        400,
        false,
        `Cannot delete badge definition; it is used by: ${dependencies.join(', ')}`
      )
      return
    }

    deleteIcon(badge.icon, 'badge')

    await BadgeDefinition.findByIdAndDelete(id)
    await enqueueBadgeEvaluationForBadge(id)
    sendResponse(res, 200, true, 'Badge definition deleted successfully')
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error deleting badge definition: ${(error as Error).message}`,
      null,
      error
    )
  }
}
