import { Model } from 'mongoose'
import { Response } from 'express'
import { Schedule } from '../models/schedule.model.js'
import { sendResponse } from './sendResponse.util.js'

export interface ReferenceCheck {
  model: Model<any>
  field?: string | string[]
  label: string
  filter?: Record<string, any>
  /** Schedule entries belonging to archived schedules never block a delete. */
  excludeArchivedSchedules?: boolean
}

export interface ReferenceBlocker {
  count: number
  label: string
}

export interface ReferenceGuardOptions {
  person?: boolean
}

async function buildReferenceFilter(
  id: any,
  check: ReferenceCheck,
  archivedScheduleIds: any[] | null
): Promise<Record<string, any>> {
  const filter: Record<string, any> = { ...(check.filter ?? {}) }

  if (check.field) {
    if (Array.isArray(check.field)) {
      filter.$or = check.field.map((field) => ({ [field]: id }))
    } else {
      filter[check.field] = id
    }
  }

  if (check.excludeArchivedSchedules) {
    filter.scheduleId = { $nin: archivedScheduleIds ?? [] }
  }

  return filter
}

export async function collectReferenceBlockers(
  id: any,
  checks: ReferenceCheck[]
): Promise<ReferenceBlocker[]> {
  const needsArchivedSchedules = checks.some((check) => check.excludeArchivedSchedules)
  const archivedScheduleIds = needsArchivedSchedules
    ? await Schedule.distinct('_id', { status: 'archived' })
    : null

  const results = await Promise.all(
    checks.map(async (check) => {
      const filter = await buildReferenceFilter(id, check, archivedScheduleIds)
      const count = await check.model.countDocuments(filter)
      return { count, label: check.label }
    })
  )

  return results.filter((result) => result.count > 0)
}

export function formatReferenceCounts(blockers: ReferenceBlocker[]): string {
  return blockers.map((blocker) => `${blocker.count} ${blocker.label}`).join(', ')
}

export function formatReferenceRefusal(
  entity: string,
  blockers: ReferenceBlocker[],
  options: ReferenceGuardOptions = {}
): string {
  const counts = formatReferenceCounts(blockers)
  return options.person
    ? `Cannot delete ${entity}: ${counts} reference them. Remove those first.`
    : `Cannot delete ${entity}: it is still referenced by ${counts}. Remove those records first.`
}

/**
 * Counts all supplied references together and sends one 400 refusal when any
 * exist. Returns true when the delete must be refused.
 */
export async function guardDeleteReferences(
  res: Response,
  entity: string,
  id: any,
  checks: ReferenceCheck[],
  options: ReferenceGuardOptions = {}
): Promise<boolean> {
  const blockers = await collectReferenceBlockers(id, checks)
  if (blockers.length === 0) return false

  sendResponse(res, 400, false, formatReferenceRefusal(entity, blockers, options))
  return true
}
