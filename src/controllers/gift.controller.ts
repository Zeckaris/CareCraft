import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { Gift } from '../models/gift.model.js'
import { BadgeDefinition } from '../models/badgeDefinition.model.js'
import { StudentBadge } from '../models/studentBadge.model.js'
import { guardDeleteReferences, type ReferenceCheck } from '../utils/referenceGuard.util.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { uploadToCloudinary, deleteFromCloudinary } from '../utils/cloudinary.util.js'

interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    role: 'admin' | 'teacher' | 'parent' | 'student' | 'coordinator'
  }
  file?: Express.Multer.File
}

const NAME_MAX_LENGTH = 120
const DESCRIPTION_MAX_LENGTH = 500

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined || value === null || value === '') return undefined
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  return null
}

async function findGiftByName(name: string, excludeId?: string) {
  const filter: any = {
    name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
  }
  if (excludeId) filter._id = { $ne: excludeId }
  return Gift.findOne(filter)
}

function deleteGiftImage(image: string | undefined | null) {
  if (!image) return
  try {
    const urlParts = image.split('/')
    const filenameWithExt = urlParts[urlParts.length - 1]
    const publicId =
      urlParts.slice(-2, -1)[0] + '/' + filenameWithExt.split('.')[0]
    void deleteFromCloudinary(publicId).catch((error) => {
      console.warn('Failed to delete Cloudinary gift image:', error)
    })
  } catch (error) {
    console.warn('Failed to parse Cloudinary gift image URL:', error)
  }
}

// ─── list ────────────────────────────────────────────────────────────────────

export const getAllGifts = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { page = 1, limit = 10, name, isActive } = req.query
  const pageNumber = Number(page)
  const limitNumber = Number(limit)

  if (
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    !Number.isInteger(limitNumber) ||
    limitNumber < 1
  ) {
    sendResponse(res, 400, false, 'page and limit must be positive integers')
    return
  }

  const filter: any = {}
  if (name !== undefined) {
    const trimmed = String(name).trim()
    if (trimmed) filter.name = { $regex: escapeRegex(trimmed), $options: 'i' }
  }
  if (isActive !== undefined) {
    const parsed = parseBoolean(isActive)
    if (parsed === null || parsed === undefined) {
      sendResponse(res, 400, false, 'Invalid isActive: must be true or false')
      return
    }
    filter.isActive = parsed
  }

  try {
    const skip = (pageNumber - 1) * limitNumber
    const gifts = await Gift.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber)
      .populate('createdBy', 'firstName lastName email role')
      .lean()
    const total = await Gift.countDocuments(filter)

    sendResponse(res, 200, true, 'Gifts fetched successfully', gifts, null, {
      total,
      page: pageNumber,
      limit: limitNumber,
    })
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error fetching gifts: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── active options (unpaginated picker) ────────────────────────────────────

export const getGiftOptions = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const gifts = await Gift.find({ isActive: true })
      .select('name description image isActive')
      .sort({ name: 1 })
      .lean()

    sendResponse(res, 200, true, 'Gift options fetched successfully', gifts)
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error fetching gift options: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── get by id ───────────────────────────────────────────────────────────────

export const getGiftById = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid gift ID')
    return
  }

  try {
    const gift = await Gift.findById(id).populate(
      'createdBy',
      'firstName lastName email role'
    )
    if (!gift) {
      sendResponse(res, 404, false, 'Gift not found')
      return
    }
    sendResponse(res, 200, true, 'Gift fetched successfully', gift)
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error fetching gift: ${(error as Error).message}`,
      null,
      error
    )
  }
}

// ─── create ──────────────────────────────────────────────────────────────────

export const createGift = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { name, description, isActive } = req.body

  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) {
    sendResponse(res, 400, false, 'Missing required field: name')
    return
  }
  if (trimmedName.length > NAME_MAX_LENGTH) {
    sendResponse(
      res,
      400,
      false,
      `name must be at most ${NAME_MAX_LENGTH} characters`
    )
    return
  }
  if (description !== undefined && description !== null && typeof description !== 'string') {
    sendResponse(res, 400, false, 'description must be a string')
    return
  }
  const trimmedDescription =
    typeof description === 'string' ? description.trim() : ''
  if (trimmedDescription.length > DESCRIPTION_MAX_LENGTH) {
    sendResponse(
      res,
      400,
      false,
      `description must be at most ${DESCRIPTION_MAX_LENGTH} characters`
    )
    return
  }

  const parsedIsActive = parseBoolean(isActive)
  if (parsedIsActive === null) {
    sendResponse(res, 400, false, 'isActive must be true or false')
    return
  }

  const createdBy = req.user?.id
  if (!createdBy || !mongoose.isValidObjectId(createdBy)) {
    sendResponse(res, 401, false, 'Authentication error: invalid or missing user')
    return
  }

  try {
    const existing = await findGiftByName(trimmedName)
    if (existing) {
      sendResponse(res, 400, false, 'Gift with this name already exists')
      return
    }

    let image: string | undefined
    if (req.file) {
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        'gifts',
        undefined,
        'image'
      )
      image = uploadResult.url
    }

    try {
      const gift = await Gift.create({
        name: trimmedName,
        description: trimmedDescription,
        image,
        isActive: parsedIsActive ?? true,
        createdBy,
      })

      const populated = await Gift.findById(gift._id).populate(
        'createdBy',
        'firstName lastName email role'
      )
      sendResponse(res, 201, true, 'Gift created successfully', populated)
    } catch (error) {
      deleteGiftImage(image)
      throw error
    }
  } catch (error: any) {
    if (error?.code === 11000) {
      sendResponse(res, 400, false, 'Gift with this name already exists')
      return
    }
    sendResponse(
      res,
      500,
      false,
      `Server error creating gift: ${error.message}`,
      null,
      error
    )
  }
}

// ─── update ──────────────────────────────────────────────────────────────────

export const updateGift = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid gift ID')
    return
  }

  const { name, description, isActive } = req.body
  const hasName = name !== undefined
  const hasDescription = description !== undefined
  const hasIsActive = isActive !== undefined

  if (!hasName && !hasDescription && !hasIsActive && !req.file) {
    sendResponse(
      res,
      400,
      false,
      'At least one field (name, description, isActive, or image) required'
    )
    return
  }

  try {
    const gift = await Gift.findById(id)
    if (!gift) {
      sendResponse(res, 404, false, 'Gift not found')
      return
    }

    const updateData: any = {}

    if (hasName) {
      if (typeof name !== 'string') {
        sendResponse(res, 400, false, 'name must be a string')
        return
      }
      const trimmedName = name.trim()
      if (!trimmedName) {
        sendResponse(res, 400, false, 'name cannot be empty')
        return
      }
      if (trimmedName.length > NAME_MAX_LENGTH) {
        sendResponse(
          res,
          400,
          false,
          `name must be at most ${NAME_MAX_LENGTH} characters`
        )
        return
      }
      if (trimmedName.toLowerCase() !== gift.name.toLowerCase()) {
        const existing = await findGiftByName(trimmedName, id)
        if (existing) {
          sendResponse(res, 400, false, 'Gift with this name already exists')
          return
        }
      }
      updateData.name = trimmedName
    }

    if (hasDescription) {
      if (description !== null && typeof description !== 'string') {
        sendResponse(res, 400, false, 'description must be a string')
        return
      }
      const trimmedDescription =
        typeof description === 'string' ? description.trim() : ''
      if (trimmedDescription.length > DESCRIPTION_MAX_LENGTH) {
        sendResponse(
          res,
          400,
          false,
          `description must be at most ${DESCRIPTION_MAX_LENGTH} characters`
        )
        return
      }
      updateData.description = trimmedDescription
    }

    if (hasIsActive) {
      const parsed = parseBoolean(isActive)
      if (parsed === null || parsed === undefined) {
        sendResponse(res, 400, false, 'isActive must be true or false')
        return
      }
      updateData.isActive = parsed
    }

    const previousImage = gift.image
    if (req.file) {
      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        'gifts',
        undefined,
        'image'
      )
      updateData.image = uploadResult.url
    }

    let updated
    try {
      updated = await Gift.findByIdAndUpdate(id, updateData, { new: true }).populate(
        'createdBy',
        'firstName lastName email role'
      )
    } catch (error) {
      deleteGiftImage(updateData.image)
      throw error
    }

    if (req.file && previousImage) {
      deleteGiftImage(previousImage)
    }

    sendResponse(res, 200, true, 'Gift updated successfully', updated)
  } catch (error: any) {
    if (error?.code === 11000) {
      sendResponse(res, 400, false, 'Gift with this name already exists')
      return
    }
    sendResponse(
      res,
      500,
      false,
      `Server error updating gift: ${error.message}`,
      null,
      error
    )
  }
}

// ─── delete ──────────────────────────────────────────────────────────────────

export const deleteGift = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id } = req.params

  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid gift ID')
    return
  }

  try {
    const gift = await Gift.findById(id)
    if (!gift) {
      sendResponse(res, 404, false, 'Gift not found')
      return
    }

    const referenceChecks: ReferenceCheck[] = [
      { model: BadgeDefinition, field: 'giftId', label: 'badge definition(s)' },
      { model: StudentBadge, field: 'giftId', label: 'student badge(s)' },
    ]

    if (await guardDeleteReferences(res, 'gift', id, referenceChecks)) return

    deleteGiftImage(gift.image)

    await Gift.findByIdAndDelete(id)
    sendResponse(res, 200, true, 'Gift deleted successfully')
  } catch (error) {
    sendResponse(
      res,
      500,
      false,
      `Server error deleting gift: ${(error as Error).message}`,
      null,
      error
    )
  }
}
