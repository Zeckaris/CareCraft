import { Request, Response } from 'express'
import { sendResponse } from '../utils/sendResponse.util.js'
import {
  EditError,
  moveEntry,
  placeLesson,
  removeEntry,
  setEntriesLocked,
  swapEntries,
  type LockFilter,
} from '../service/scheduleEdit.service.js'

function handleError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof EditError) {
    sendResponse(res, error.statusCode, false, error.message, error.payload)
    return
  }
  sendResponse(res, 500, false, fallback, null, error)
}

/**
 * POST /api/schedule/schedules/:id/entries/:entryId/move
 * Roles: admin, coordinator
 *
 * Moves a (single or double) entry to a free slot. A double moves as a unit.
 * Body: { day, period, version }
 */
export const moveScheduleEntry = async (req: Request, res: Response): Promise<void> => {
  const { id, entryId } = req.params
  const { day, period, version } = req.body ?? {}
  try {
    const result = await moveEntry(id, entryId, day, period, version)
    sendResponse(res, 200, true, 'Entry moved', result)
  } catch (error) {
    handleError(res, error, 'Server error moving entry')
  }
}

/**
 * POST /api/schedule/schedules/:id/entries/swap
 * Roles: admin, coordinator
 *
 * Swaps two entries (single↔single or double↔double). Body: { entryIdA, entryIdB, version }
 */
export const swapScheduleEntries = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const { entryIdA, entryIdB, version } = req.body ?? {}
  if (!entryIdA || !entryIdB || typeof entryIdA !== 'string' || typeof entryIdB !== 'string') {
    sendResponse(res, 400, false, 'entryIdA and entryIdB are required')
    return
  }
  try {
    const result = await swapEntries(id, entryIdA, entryIdB, version)
    sendResponse(res, 200, true, 'Entries swapped', result)
  } catch (error) {
    handleError(res, error, 'Server error swapping entries')
  }
}

/**
 * POST /api/schedule/schedules/:id/entries/:entryId/remove
 * Roles: admin, coordinator
 *
 * Removes an entry (a double is removed as a unit) and adds the periods back to
 * the unplaced list. Body: { version }
 */
export const removeScheduleEntry = async (req: Request, res: Response): Promise<void> => {
  const { id, entryId } = req.params
  const { version } = req.body ?? {}
  try {
    const result = await removeEntry(id, entryId, version)
    sendResponse(res, 200, true, 'Entry removed', result)
  } catch (error) {
    handleError(res, error, 'Server error removing entry')
  }
}

/**
 * POST /api/schedule/schedules/:id/unplaced/place
 * Roles: admin, coordinator
 *
 * Places an unplaced lesson into a chosen slot. Body: { lessonId, day, period, double?, version }
 */
export const placeUnplacedLesson = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const { lessonId, day, period, double, version } = req.body ?? {}
  if (!lessonId || typeof lessonId !== 'string') {
    sendResponse(res, 400, false, 'lessonId is required')
    return
  }
  try {
    const result = await placeLesson(id, lessonId, day, period, double, version)
    sendResponse(res, 201, true, 'Lesson placed', result)
  } catch (error) {
    handleError(res, error, 'Server error placing lesson')
  }
}

/**
 * POST /api/schedule/schedules/:id/lock
 * Roles: admin, coordinator
 *
 * Locks/unlocks a single set of entries (entryIds) or a bulk filter
 * (sectionId, teacherId, gradeId, day). Body: { entryIds?, filter?, locked, version }
 */
export const lockScheduleEntries = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const { entryIds, filter, locked, version } = req.body ?? {}
  if (typeof locked !== 'boolean') {
    sendResponse(res, 400, false, 'locked must be a boolean')
    return
  }
  try {
    const result = await setEntriesLocked(id, {
      entryIds: Array.isArray(entryIds) ? entryIds : undefined,
      filter: filter as LockFilter | undefined,
      locked,
      version,
    })
    sendResponse(res, 200, true, locked ? 'Entries locked' : 'Entries unlocked', result)
  } catch (error) {
    handleError(res, error, 'Server error updating locks')
  }
}
