/**
 * scheduleIndexes.util.ts
 *
 * Additive, best-effort index bootstrap run once at startup. It calls
 * `createIndexes()` on the schedule models so any newly declared indexes (for
 * example the "one published schedule per school year" partial unique index)
 * are created without ever dropping or rebuilding existing indexes.
 *
 * `syncIndexes()` is deliberately NOT used: it would drop indexes that are no
 * longer in the schema, which is destructive for a live database.
 */

import { Schedule } from '../models/schedule.model.js'
import { ScheduleEntry } from '../models/scheduleEntry.model.js'
import { GenerationJob } from '../models/generationJob.model.js'

export async function ensureScheduleIndexes(): Promise<void> {
  try {
    await Promise.all([
      Schedule.createIndexes(),
      ScheduleEntry.createIndexes(),
      GenerationJob.createIndexes(),
    ])
  } catch (error) {
    console.error('Failed to ensure schedule indexes', error)
  }
}
