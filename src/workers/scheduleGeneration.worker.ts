/**
 * scheduleGeneration.worker.ts
 *
 * Worker-thread entry for a single school-wide generation run. It receives
 * plain, structured-clonable data through `workerData`, runs the pure solver and
 * validator, and posts back entries, unplaced lessons, stats and violations.
 *
 * Because the tsx loader is NOT inherited by worker threads, the solver and
 * validator modules are imported dynamically with an extension that matches
 * this file's own extension: `.ts` in development (Node native type stripping)
 * and `.js` in the compiled build. Both modules are self-contained (type-only
 * project imports), so no other project module needs resolving here.
 */

import { parentPort, workerData } from 'node:worker_threads'

interface WorkerInput {
  settings: unknown
  lessons: unknown
  lockedEntries: unknown[]
  seed: number
  iterationBudget: number
  timeBudgetMs: number
}

function fail(err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err))
  parentPort?.postMessage({ type: 'error', error: { message: error.message, stack: error.stack } })
}

async function main(): Promise<void> {
  const input = workerData as WorkerInput
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js'

  const solverMod: any = await import(`../utils/scheduleSolver.util${ext}`)
  const validatorMod: any = await import(`../utils/scheduleValidator.util${ext}`)

  parentPort?.postMessage({ type: 'phase', phase: 'solving', percent: 30 })

  const solved = solverMod.solveSchedule({
    settings: input.settings,
    lessons: input.lessons,
    lockedEntries: input.lockedEntries,
    seed: input.seed,
    iterationBudget: input.iterationBudget,
    timeBudgetMs: input.timeBudgetMs,
  })

  parentPort?.postMessage({ type: 'phase', phase: 'validating', percent: 85 })

  const violations = validatorMod.validateSchedule({
    settings: input.settings,
    lessons: input.lessons,
    entries: solved.entries,
  })

  parentPort?.postMessage({
    type: 'result',
    payload: {
      entries: solved.entries,
      unplaced: solved.unplaced,
      stats: solved.stats,
      violations,
    },
  })
}

main().catch(fail)
