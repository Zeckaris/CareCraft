/**
 * scheduleIndexes.util.ts
 *
 * Startup index bootstrap for the Schedule collection.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Schedule schema originally declared two partial-unique indexes on
 * { schoolYear: 1 } without explicit names.  Mongoose derived the name from
 * the key-spec alone, so both indexes received the auto-name "schoolYear_1".
 * MongoDB rejects the second createIndex call with:
 *   IndexKeySpecsConflict (code 86): An existing index has the same name but
 *   different key or options.
 *
 * The fix gives each index an explicit, distinct name:
 *   • "schoolYear_1_draft_unique"     (partialFilterExpression: { status: 'draft' })
 *   • "schoolYear_1_published_unique" (partialFilterExpression: { status: 'published' })
 *
 * MIGRATION
 * ---------
 * A database that was created before the rename may already carry the legacy
 * "schoolYear_1" partial-unique index.  If we call createIndexes() directly,
 * MongoDB sees a new name for an equivalent key-spec (or vice-versa) and
 * raises another IndexKeySpecsConflict.  The routine therefore:
 *
 *   1. Lists the existing indexes on the Schedule collection.
 *   2. Looks for one named "schoolYear_1" that also carries a
 *      partialFilterExpression (the distinguishing trait of the legacy index;
 *      the plain compound indexes on schoolYear share the same key but have a
 *      different auto-name such as "schoolYear_1_status_1").
 *   3. If found, drops it so the slot is free.
 *   4. Calls createIndexes() on all three models – idempotent because MongoDB
 *      is a no-op when an index with the same name and spec already exists.
 *
 * The entire routine is wrapped in a try/catch: a failure is logged but never
 * re-thrown so it cannot crash the server on startup.
 */

import type { Collection, Document } from 'mongodb'
import { Schedule } from '../models/schedule.model.js'
import { ScheduleEntry } from '../models/scheduleEntry.model.js'
import { GenerationJob } from '../models/generationJob.model.js'

/** Name that Mongoose assigned to the legacy conflicting index. */
const LEGACY_INDEX_NAME = 'schoolYear_1'

/**
 * Returns true when `info` looks like the legacy auto-named partial-unique
 * index on schoolYear (as opposed to the plain compound index
 * "schoolYear_1_status_1" or "schoolYear_1_createdAt_-1").
 */
function isLegacyPartialIndex(info: Document): boolean {
  return (
    info['name'] === LEGACY_INDEX_NAME &&
    info['partialFilterExpression'] != null
  )
}

/**
 * Drop the legacy "schoolYear_1" partial-unique index from the Schedule
 * collection if it still exists.  Safe to call when the index is absent.
 */
async function dropLegacyScheduleIndex(
  collection: Collection<Document>
): Promise<void> {
  const existingIndexes: Document[] = await collection.indexes()
  const legacy = existingIndexes.find(isLegacyPartialIndex)

  if (!legacy) {
    // Nothing to do – either a fresh DB or migration already ran.
    return
  }

  console.log(
    '[scheduleIndexes] Detected legacy auto-named index "%s" ' +
      '(partialFilterExpression: %s). Dropping it to allow named replacements.',
    LEGACY_INDEX_NAME,
    JSON.stringify(legacy['partialFilterExpression'])
  )

  await collection.dropIndex(LEGACY_INDEX_NAME)

  console.log(
    '[scheduleIndexes] Legacy index "%s" dropped successfully.',
    LEGACY_INDEX_NAME
  )
}

export async function ensureScheduleIndexes(): Promise<void> {
  try {
    // Mongoose exposes the underlying driver collection via .collection.
    // The cast is safe because the model is always registered against an
    // active connection by the time this function is called.
    const scheduleCollection = Schedule.collection as unknown as Collection<Document>

    // Step 1 – remove the conflicting legacy index, if present.
    await dropLegacyScheduleIndex(scheduleCollection)

    // Step 2 – create all declared indexes idempotently.
    //
    // createIndexes() is a no-op for indexes that already exist with the
    // same name and spec.  It is deliberately used instead of syncIndexes()
    // to avoid dropping indexes that are present in the database but absent
    // from the schema (e.g. indexes added out-of-band for operations).
    await Promise.all([
      Schedule.createIndexes(),
      ScheduleEntry.createIndexes(),
      GenerationJob.createIndexes(),
    ])

    console.log('[scheduleIndexes] Schedule indexes ensured successfully.')
  } catch (error) {
    // Log but never re-throw: a missing index degrades performance / loses a
    // uniqueness guarantee, but it must not prevent the server from starting.
    console.error('Failed to ensure schedule indexes:', error)
  }
}
