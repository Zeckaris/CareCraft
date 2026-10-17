import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { solveSchedule, type SolverInput } from '../utils/scheduleSolver.util.js'
import { validateSchedule, type ScheduleEntry } from '../utils/scheduleValidator.util.js'
import { DAYS, entry, lesson, makeSettings } from './fixtures.js'

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    schoolYear: '2025-2026',
    settings: makeSettings(),
    lessons: [],
    seed: 42,
    iterationBudget: 4000,
    timeBudgetMs: 20000,
    ...overrides,
  }
}

function schoolWideLessons(): ReturnType<typeof lesson>[] {
  const subjects = ['A', 'B', 'C', 'D', 'E']
  const grades = ['G1', 'G2', 'G3', 'G4']
  const out: ReturnType<typeof lesson>[] = []
  for (const g of grades) {
    for (const n of ['1', '2']) {
      const sectionId = `${g}-${n}`
      for (const s of subjects) {
        out.push(lesson(sectionId, s, `T-${g}-${s}`, 5, 'none', g))
      }
    }
  }
  return out
}

function noSlotConflicts(entries: ScheduleEntry[]): boolean {
  const section = new Set<string>()
  const teacher = new Set<string>()
  for (const e of entries) {
    const sk = `${e.sectionId}|${e.day}|${e.period}`
    const tk = `${e.teacherId}|${e.day}|${e.period}`
    if (section.has(sk) || teacher.has(tk)) return false
    section.add(sk)
    teacher.add(tk)
  }
  return true
}

test('property: many seeds yield zero hard violations and a clean validation', () => {
  const settings = makeSettings({ periodsPerDay: 6, groups: [6], dailyTeachingCap: 6 })
  const lessons = schoolWideLessons()
  for (let seed = 1; seed <= 20; seed++) {
    const result = solveSchedule(baseInput({ settings, lessons, seed, iterationBudget: 800 }))
    assert.equal(result.stats.hardViolations, 0, `seed ${seed} hard violations`)
    assert.equal(
      validateSchedule({ settings, lessons, entries: result.entries }).length,
      0,
      `seed ${seed} validator violations`
    )
    assert.ok(noSlotConflicts(result.entries), `seed ${seed} slot conflict`)
    assert.equal(result.unplaced.length, 0, `seed ${seed} left lessons unplaced`)
  }
})

test('property: identical seed and budget produce identical output', () => {
  const settings = makeSettings({ periodsPerDay: 6, groups: [6], dailyTeachingCap: 6 })
  const lessons = schoolWideLessons()
  for (const seed of [3, 8, 15]) {
    const a = solveSchedule(baseInput({ settings, lessons, seed }))
    const b = solveSchedule(baseInput({ settings, lessons, seed }))
    assert.deepEqual(a.entries, b.entries, `seed ${seed} not deterministic`)
    assert.deepEqual(a.unplaced, b.unplaced, `seed ${seed} unplaced not deterministic`)
  }
})

test('locked entries stay fixed while the rest of the week is filled', () => {
  const settings = makeSettings({ periodsPerDay: 5, groups: [5] })
  const lessons = [lesson('S1', 'A', 'T1', 5)]
  const locked = entry('S1', 'A', 'T1', 'monday', 1)
  const result = solveSchedule(baseInput({ settings, lessons, lockedEntries: [locked] }))

  const kept = result.entries.find(
    (e) => e.sectionId === 'S1' && e.subjectId === 'A' && e.day === 'monday' && e.period === 1
  )
  assert.ok(kept, 'locked entry was moved or dropped')
  assert.equal(kept!.locked, true)
  assert.equal(result.entries.length, 5)
  assert.equal(result.unplaced.length, 0)
  assert.equal(result.stats.hardViolations, 0)
})

test('locked entries always survive even when the school is infeasible', () => {
  // One teacher forced far beyond capacity; the lock must remain untouched.
  const settings = makeSettings({ periodsPerDay: 5, dailyTeachingCap: 5 })
  const lessons = ['A', 'B', 'C', 'D', 'E', 'F'].map((s) => lesson(`S-${s}`, s, 'T1', 6))
  const locked = entry('S-A', 'A', 'T1', 'monday', 1)
  const result = solveSchedule(baseInput({ settings, lessons, lockedEntries: [locked] }))

  const kept = result.entries.find(
    (e) => e.sectionId === 'S-A' && e.subjectId === 'A' && e.day === 'monday' && e.period === 1
  )
  assert.ok(kept, 'locked entry was lost')
  assert.equal(result.stats.hardViolations, 0)
})

test('a teacher exactly at the daily and weekly caps is fully scheduled', () => {
  const settings = makeSettings({
    periodsPerDay: 5,
    groups: [5],
    dailyTeachingCap: 5,
    maximumWeeklyTaughtPeriods: 25,
  })
  // One teacher, five sections x five periods = 25 = weekly cap, 5/day = daily cap.
  const lessons = ['S1', 'S2', 'S3', 'S4', 'S5'].map((s) => lesson(s, 'A', 'T1', 5))
  const result = solveSchedule(baseInput({ settings, lessons }))

  assert.equal(result.entries.length, 25)
  assert.equal(result.unplaced.length, 0)
  assert.equal(result.stats.hardViolations, 0)
  const perDay = new Map<string, number>()
  for (const e of result.entries) perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1)
  for (const day of DAYS) assert.equal(perDay.get(day), 5)
})

test('a section whose subjects fill every slot is scheduled completely', () => {
  const settings = makeSettings({ periodsPerDay: 5, groups: [5] })
  const lessons = ['A', 'B', 'C', 'D', 'E'].map((s, i) => lesson('S1', s, `T${i}`, 5))
  const result = solveSchedule(baseInput({ settings, lessons }))

  assert.equal(result.entries.length, 25)
  assert.equal(result.unplaced.length, 0)
  assert.equal(result.stats.hardViolations, 0)
  const occupied = new Set(result.entries.map((e) => `${e.day}|${e.period}`))
  assert.equal(occupied.size, 25)
})

test('a run split by a break does not count as consecutive', () => {
  const lessons = ['A', 'B', 'C', 'D', 'E'].map((s) => lesson('S1', s, 'T1', 1))
  // Five periods in a row on monday for one teacher.
  const manual: ScheduleEntry[] = ['A', 'B', 'C', 'D', 'E'].map((s, i) =>
    entry('S1', s, 'T1', 'monday', i + 1)
  )

  // Groups [3,2]: periods 1-3 and 4-5 are separated by a break, so the longest
  // run inside a group is 3 and the max of 3 is respected.
  const split = makeSettings({
    periodsPerDay: 5,
    groups: [3, 2],
    dailyTeachingCap: 5,
    maximumConsecutivePeriods: 3,
  })
  assert.equal(
    validateSchedule({ settings: split, lessons, entries: manual }).filter(
      (v) => v.code === 'TEACHER_CONSECUTIVE'
    ).length,
    0
  )

  // Without the break (one 5-period group) the same periods form a run of 5.
  const noBreak = makeSettings({
    periodsPerDay: 5,
    groups: [5],
    dailyTeachingCap: 5,
    maximumConsecutivePeriods: 3,
  })
  assert.equal(
    validateSchedule({ settings: noBreak, lessons, entries: manual }).filter(
      (v) => v.code === 'TEACHER_CONSECUTIVE'
    ).length,
    1
  )
})

interface WorkerResult {
  entries: any[]
  unplaced: any[]
  stats: any
  violations: any[]
}

function runWorkerOnce(workerData: unknown): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/scheduleGeneration.worker.ts', import.meta.url), {
      workerData,
    })
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
      worker.terminate().catch(() => undefined)
    }
    worker.on('message', (msg: any) => {
      if (msg?.type === 'result') done(() => resolve(msg.payload as WorkerResult))
      else if (msg?.type === 'error') done(() => reject(new Error(msg.error?.message ?? 'worker error')))
    })
    worker.on('error', (err) => done(() => reject(err)))
    worker.on('exit', (code) => {
      if (code !== 0) done(() => reject(new Error(`worker exited with code ${code}`)))
    })
  })
}

test('generation runs off the event loop (worker keeps the main thread responsive)', async () => {
  const settings = makeSettings({ periodsPerDay: 6, groups: [6], dailyTeachingCap: 6 })
  const lessons = schoolWideLessons()
  const workerData = {
    settings,
    lessons,
    lockedEntries: [],
    seed: 5,
    iterationBudget: 200000,
    timeBudgetMs: 3000,
  }

  let maxDelay = 0
  let last = Date.now()
  const timer = setInterval(() => {
    const now = Date.now()
    maxDelay = Math.max(maxDelay, now - last - 10)
    last = now
  }, 10)

  let result: WorkerResult
  try {
    result = await runWorkerOnce(workerData)
  } finally {
    clearInterval(timer)
  }

  assert.ok(result.entries.length > 0, 'worker produced no entries')
  assert.equal(result.stats.hardViolations, 0)
  assert.equal(result.violations.length, 0)
  assert.ok(maxDelay < 1000, `main thread stalled for ${maxDelay}ms during generation`)
})
