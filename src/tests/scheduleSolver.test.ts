import { test } from 'node:test'
import assert from 'node:assert/strict'
import { solveSchedule, type SolverInput } from '../utils/scheduleSolver.util.js'
import { validateSchedule } from '../utils/scheduleValidator.util.js'
import { DAYS, lesson, makeSettings } from './fixtures.js'

function baseInput(overrides: Partial<SolverInput> = {}): SolverInput {
  return {
    schoolYear: '2025-2026',
    settings: makeSettings(),
    lessons: [],
    seed: 42,
    iterationBudget: 600,
    timeBudgetMs: 5000,
    ...overrides,
  }
}

test('solver places a feasible full week with no hard violations', () => {
  const lessons = ['A', 'B', 'C', 'D', 'E'].map((s, i) => lesson('S1', s, `T${i}`, 5))
  const result = solveSchedule(baseInput({ lessons }))

  assert.equal(result.unplaced.length, 0)
  assert.equal(result.entries.length, 25)
  assert.equal(result.stats.hardViolations, 0)
  assert.equal(validateSchedule({ settings: makeSettings(), lessons, entries: result.entries }).length, 0)
})

test('solver is deterministic for the same seed and budget', () => {
  const lessons = ['A', 'B', 'C', 'D', 'E'].map((s, i) => lesson('S1', s, `T${i}`, 5))
  const a = solveSchedule(baseInput({ lessons, seed: 7 }))
  const b = solveSchedule(baseInput({ lessons, seed: 7 }))
  assert.deepEqual(a.entries, b.entries)
  assert.equal(a.stats.hardViolations, 0)
})

test('solver produces a double inside one block when required', () => {
  const settings = makeSettings({ periodsPerDay: 5, groups: [3, 2] })
  const lessons = [lesson('S1', 'A', 'T1', 4, 'required'), lesson('S1', 'B', 'T2', 3)]
  const result = solveSchedule(baseInput({ settings, lessons }))

  assert.equal(result.unplaced.length, 0)
  const doubles = result.entries.filter((e) => e.sectionId === 'S1' && e.subjectId === 'A' && e.doubleGroupId)
  assert.equal(doubles.length, 2)
  const [x, y] = doubles
  assert.equal(x.day, y.day)
  assert.equal(Math.abs(x.period - y.period), 1)
  // adjacency must stay inside a block: [1,2,3] or [4,5]
  const [p, q] = [x.period, y.period].sort((m, n) => m - n)
  assert.ok((p === 1 && q === 2) || (p === 2 && q === 3) || (p === 4 && q === 5))
  assert.equal(result.stats.hardViolations, 0)
})

test('solver reports a required double as unplaced when no block allows it', () => {
  // Four single-period blocks: no two periods are adjacent within a block.
  const settings = makeSettings({ periodsPerDay: 4, groups: [1, 1, 1, 1] })
  const lessons = [lesson('S1', 'A', 'T1', 4, 'required')]
  const result = solveSchedule(baseInput({ settings, lessons }))

  assert.equal(result.entries.length, 0)
  assert.equal(result.unplaced.length, 1)
  assert.equal(result.unplaced[0].reason, 'NO_DOUBLE_BLOCK')
  assert.equal(result.stats.hardViolations, 0)
  assert.equal(validateSchedule({ settings, lessons, entries: result.entries }).length, 0)
})

test('solver reports unplaced lessons when a teacher is over capacity', () => {
  const settings = makeSettings({ periodsPerDay: 5, dailyTeachingCap: 5 })
  // 1 teacher, 30 periods needed, but daily cap 5 across 5 days = 25 capacity.
  const lessons = [
    lesson('S1', 'A', 'T1', 6),
    lesson('S2', 'A', 'T1', 6),
    lesson('S3', 'A', 'T1', 6),
    lesson('S4', 'A', 'T1', 6),
    lesson('S5', 'A', 'T1', 6),
  ]
  const result = solveSchedule(baseInput({ settings, lessons }))

  assert.ok(result.unplaced.length > 0)
  assert.ok(result.unplaced.reduce((sum, u) => sum + u.periods, 0) >= 5)
  assert.equal(result.stats.hardViolations, 0)
})

test('solver never double-books a teacher shared across sections', () => {
  const lessons = [
    lesson('S1', 'A', 'T1', 5),
    lesson('S2', 'A', 'T1', 5),
  ]
  const result = solveSchedule(baseInput({ lessons }))
  const seen = new Set<string>()
  for (const e of result.entries) {
    const k = `${e.teacherId}|${e.day}|${e.period}`
    assert.ok(!seen.has(k), `teacher clash at ${k}`)
    seen.add(k)
  }
  assert.equal(result.unplaced.length, 0)
})

test('solver fills a multi-grade school-wide run', () => {
  const settings = makeSettings({ periodsPerDay: 6, groups: [6], dailyTeachingCap: 6 })
  const subjects = ['A', 'B', 'C', 'D', 'E', 'F']
  const grades = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']
  const lessons = grades.flatMap((g) =>
    ['1', '2'].flatMap((n) =>
      subjects.map((s) => lesson(`G${g}-${n}`, s, `T-${g}-${s}`, 5, 'none', g))
    )
  )
  const result = solveSchedule(
    baseInput({ settings, lessons, seed: 99, iterationBudget: 1200, timeBudgetMs: 15000 })
  )
  assert.equal(result.entries.length, 360)
  assert.equal(result.unplaced.length, 0)
  assert.equal(result.stats.hardViolations, 0)
  assert.equal(
    validateSchedule({ settings, lessons, entries: result.entries }).length,
    0
  )
})

test('solver keeps one occurrence of a subject per day when slots allow', () => {
  const lessons = [lesson('S1', 'A', 'T1', 5)]
  const result = solveSchedule(baseInput({ lessons }))
  const perDay = new Map<string, number>()
  for (const e of result.entries) {
    perDay.set(e.day, (perDay.get(e.day) ?? 0) + 1)
  }
  assert.equal(result.entries.length, 5)
  for (const day of DAYS) assert.ok((perDay.get(day) ?? 0) <= 1)
  assert.equal(result.stats.hardViolations, 0)
})
