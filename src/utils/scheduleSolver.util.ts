/**
 * scheduleSolver.util.ts
 *
 * Pure, self-contained school-wide schedule solver. No database, Express or
 * other runtime project imports (only `import type`), so it can run inside a
 * worker thread in both development (native TypeScript stripping) and the
 * compiled build.
 *
 * Generation is school-wide in one run: every active section that has
 * requirements is scheduled together so that section and teacher slots are
 * globally consistent.
 *
 * Hard rules (never violated, including during improvement):
 *  - a section holds at most one lesson per slot;
 *  - a teacher holds at most one lesson per slot across the whole school;
 *  - a teacher stays within the per-day teaching cap and the weekly cap;
 *  - a teacher's consecutive run stays within the maximum (a break resets it);
 *  - a subject appears at most once per day per section (raised when its weekly
 *    count exceeds the number of enabled days);
 *  - a double occupies two adjacent periods inside one block;
 *  - each lesson receives at most its weekly count (shortfall = unplaced);
 *  - locked entries are never moved.
 *
 * Determinism: identical input, seed and iteration budget produce identical
 * output when the iteration budget is the binding stop (the wall-clock cap is a
 * safety net and may shorten a run; that is reported via `stats.timedOut`).
 */

import type { DoublePeriodOption, ScheduleDay } from './scheduleSetting.util.js'
import type {
  DayDerivedInput,
  ScheduleEntry,
  ValidationLesson,
  ValidationSettings,
} from './scheduleValidator.util.js'

// ─── types ───────────────────────────────────────────────────────────────────

export interface SoftWeights {
  spreadSubjectAcrossWeek: number
  varyPeriodPosition: number
  teacherIdleGaps: number
  teacherLoadBalance: number
  teacherRunLength: number
}

export const SOFT_WEIGHTS: SoftWeights = {
  spreadSubjectAcrossWeek: 10,
  varyPeriodPosition: 6,
  teacherIdleGaps: 5,
  teacherLoadBalance: 8,
  teacherRunLength: 3,
}

const SECTION_DAY_BALANCE = 6

export interface SolverInput {
  schoolYear: string
  settings: ValidationSettings
  lessons: ValidationLesson[]
  lockedEntries?: ScheduleEntry[]
  seed: number
  iterationBudget: number
  timeBudgetMs: number
  softWeights?: Partial<SoftWeights>
}

export interface UnplacedLesson {
  lessonId: string
  sectionId: string
  gradeId: string
  subjectId: string
  teacherId: string
  periods: number
  reason: string
  reasons: Record<string, number>
}

export interface SolverStats {
  seed: number
  restarts: number
  iterations: number
  elapsedMs: number
  timedOut: boolean
  hardViolations: number
  softScore: number
  softBreakdown: SoftWeights
}

export interface SolverOutput {
  entries: ScheduleEntry[]
  unplaced: UnplacedLesson[]
  stats: SolverStats
}

// ─── deterministic PRNG ──────────────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── layout (self-contained copy) ────────────────────────────────────────────

interface Layout {
  day: ScheduleDay
  periodsPerDay: number
  dailyTeachingCap: number
  groupIndex: number[]
  groupStart: number[]
  groupEnd: number[]
}

function buildLayout(settings: ValidationSettings): Map<ScheduleDay, Layout> {
  const map = new Map<ScheduleDay, Layout>()
  for (const d of settings.perDay) {
    const periodsPerDay = Math.max(0, Math.floor(d.periodsPerDay))
    const groupIndex = new Array<number>(periodsPerDay).fill(0)
    const groupStart: number[] = []
    const groupEnd: number[] = []
    let period = 1
    let gi = 0
    for (const size of d.groups) {
      const s = Math.max(0, Math.floor(size))
      if (s <= 0) continue
      groupStart[gi] = period
      for (let i = 0; i < s && period <= periodsPerDay; i++) {
        groupIndex[period - 1] = gi
        period++
      }
      groupEnd[gi] = period - 1
      gi++
    }
    while (period <= periodsPerDay) {
      groupStart[gi] = period
      groupIndex[period - 1] = gi
      groupEnd[gi] = period
      period++
      gi++
    }
    map.set(d.day, {
      day: d.day,
      periodsPerDay,
      dailyTeachingCap: Math.max(0, Math.floor(d.dailyTeachingCap)),
      groupIndex,
      groupStart,
      groupEnd,
    })
  }
  return map
}

function subjectDailyLimit(periodsPerWeek: number, enabledDayCount: number): number {
  if (enabledDayCount <= 0) return periodsPerWeek
  return periodsPerWeek > enabledDayCount ? Math.ceil(periodsPerWeek / enabledDayCount) : 1
}

// ─── state ───────────────────────────────────────────────────────────────────

const SEP = '\u0001'
const key = (...parts: (string | number)[]) => parts.join(SEP)

interface State {
  sectionSlot: Map<string, ScheduleEntry>
  teacherSlot: Map<string, ScheduleEntry>
  teacherDay: Map<string, number>
  teacherWeek: Map<string, number>
  subjectDay: Map<string, number>
  sectionDay: Map<string, number>
  lessonCount: Map<string, number>
  periodIndexCount: Map<string, number>
  doubleGroupsByLesson: Map<string, Set<string>>
  /** double group ids present per section|subject|day (for occurrence counts). */
  doubleGroupsByDay: Map<string, Set<string>>
}

function newState(): State {
  return {
    sectionSlot: new Map(),
    teacherSlot: new Map(),
    teacherDay: new Map(),
    teacherWeek: new Map(),
    subjectDay: new Map(),
    sectionDay: new Map(),
    lessonCount: new Map(),
    periodIndexCount: new Map(),
    doubleGroupsByLesson: new Map(),
    doubleGroupsByDay: new Map(),
  }
}

function addEntry(state: State, entry: ScheduleEntry): void {
  state.sectionSlot.set(key(entry.sectionId, entry.day, entry.period), entry)
  state.teacherSlot.set(key(entry.teacherId, entry.day, entry.period), entry)
  const td = key(entry.teacherId, entry.day)
  state.teacherDay.set(td, (state.teacherDay.get(td) ?? 0) + 1)
  state.teacherWeek.set(entry.teacherId, (state.teacherWeek.get(entry.teacherId) ?? 0) + 1)
  const sd = key(entry.sectionId, entry.subjectId, entry.day)
  state.subjectDay.set(sd, (state.subjectDay.get(sd) ?? 0) + 1)
  const secd = key(entry.sectionId, entry.day)
  state.sectionDay.set(secd, (state.sectionDay.get(secd) ?? 0) + 1)
  const lesson = key(entry.sectionId, entry.subjectId)
  state.lessonCount.set(lesson, (state.lessonCount.get(lesson) ?? 0) + 1)
  const pi = key(lesson, entry.period)
  state.periodIndexCount.set(pi, (state.periodIndexCount.get(pi) ?? 0) + 1)
  if (entry.doubleGroupId) {
    if (!state.doubleGroupsByLesson.has(lesson)) state.doubleGroupsByLesson.set(lesson, new Set())
    state.doubleGroupsByLesson.get(lesson)!.add(entry.doubleGroupId)
    const dd = key(entry.sectionId, entry.subjectId, entry.day)
    if (!state.doubleGroupsByDay.has(dd)) state.doubleGroupsByDay.set(dd, new Set())
    state.doubleGroupsByDay.get(dd)!.add(entry.doubleGroupId)
  }
}

function removeEntry(state: State, entry: ScheduleEntry): void {
  state.sectionSlot.delete(key(entry.sectionId, entry.day, entry.period))
  state.teacherSlot.delete(key(entry.teacherId, entry.day, entry.period))
  const td = key(entry.teacherId, entry.day)
  state.teacherDay.set(td, (state.teacherDay.get(td) ?? 0) - 1)
  state.teacherWeek.set(entry.teacherId, (state.teacherWeek.get(entry.teacherId) ?? 0) - 1)
  const sd = key(entry.sectionId, entry.subjectId, entry.day)
  state.subjectDay.set(sd, (state.subjectDay.get(sd) ?? 0) - 1)
  const secd = key(entry.sectionId, entry.day)
  state.sectionDay.set(secd, (state.sectionDay.get(secd) ?? 0) - 1)
  const lesson = key(entry.sectionId, entry.subjectId)
  state.lessonCount.set(lesson, (state.lessonCount.get(lesson) ?? 0) - 1)
  const pi = key(lesson, entry.period)
  state.periodIndexCount.set(pi, (state.periodIndexCount.get(pi) ?? 0) - 1)
  if (entry.doubleGroupId) {
    state.doubleGroupsByLesson.get(lesson)?.delete(entry.doubleGroupId)
    state.doubleGroupsByDay.get(sd)?.delete(entry.doubleGroupId)
  }
}

/**
 * Number of subject "occurrences" for a section/subject on a day. A double
 * period counts as a single occurrence (its two entries collapse to one), so a
 * required double is allowed even when the day allows the subject only once.
 */
function occurrencesOnDay(
  state: State,
  sectionId: string,
  subjectId: string,
  day: ScheduleDay
): number {
  const entries = state.subjectDay.get(key(sectionId, subjectId, day)) ?? 0
  const doubles = state.doubleGroupsByDay.get(key(sectionId, subjectId, day))?.size ?? 0
  return entries - doubles
}

function hasPeriod(layout: Layout, period: number): boolean {
  return period >= 1 && period <= layout.periodsPerDay
}

function lessonKeyOf(lesson: ValidationLesson): string {
  return key(lesson.sectionId, lesson.subjectId)
}

// ─── context ─────────────────────────────────────────────────────────────────

interface Ctx {
  settings: ValidationSettings
  layout: Map<ScheduleDay, Layout>
  enabledDays: ScheduleDay[]
  enabledDayCount: number
  maxWeekly: number | null
  maxConsec: number | null
  weights: SoftWeights
  slots: Array<{ day: ScheduleDay; period: number }>
}

function buildCtx(input: SolverInput): Ctx {
  const layout = buildLayout(input.settings)
  const enabledDays = input.settings.enabledDays.filter((d) => layout.has(d))
  const slots: Array<{ day: ScheduleDay; period: number }> = []
  for (const day of enabledDays) {
    const dl = layout.get(day)!
    for (let p = 1; p <= dl.periodsPerDay; p++) slots.push({ day, period: p })
  }
  return {
    settings: input.settings,
    layout,
    enabledDays,
    enabledDayCount: enabledDays.length,
    maxWeekly: input.settings.maximumWeeklyTaughtPeriods,
    maxConsec: input.settings.maximumConsecutivePeriods,
    weights: { ...SOFT_WEIGHTS, ...(input.softWeights ?? {}) },
    slots,
  }
}

// ─── feasibility ─────────────────────────────────────────────────────────────

function maxRunIfAdded(
  state: State,
  teacher: string,
  day: ScheduleDay,
  added: number[],
  ctx: Ctx
): number {
  const dl = ctx.layout.get(day)
  if (!dl) return 0
  const addedSet = new Set(added)
  const touched = new Set<number>()
  for (const p of added) if (hasPeriod(dl, p)) touched.add(dl.groupIndex[p - 1])

  let maxRun = 0
  for (const g of touched) {
    let run = 0
    for (let p = dl.groupStart[g]; p <= dl.groupEnd[g]; p++) {
      const occupied = addedSet.has(p) || state.teacherSlot.has(key(teacher, day, p))
      if (occupied) {
        run++
        if (run > maxRun) maxRun = run
      } else {
        run = 0
      }
    }
  }
  return maxRun
}

function canPlaceSingle(
  state: State,
  lesson: ValidationLesson,
  day: ScheduleDay,
  period: number,
  ctx: Ctx
): boolean {
  const dl = ctx.layout.get(day)
  if (!dl || !hasPeriod(dl, period)) return false
  if (state.sectionSlot.has(key(lesson.sectionId, day, period))) return false
  if (state.teacherSlot.has(key(lesson.teacherId, day, period))) return false
  if ((state.teacherDay.get(key(lesson.teacherId, day)) ?? 0) + 1 > dl.dailyTeachingCap) return false
  if (ctx.maxWeekly !== null && (state.teacherWeek.get(lesson.teacherId) ?? 0) + 1 > ctx.maxWeekly) {
    return false
  }
  const limit = subjectDailyLimit(lesson.periodsPerWeek, ctx.enabledDayCount)
  if (occurrencesOnDay(state, lesson.sectionId, lesson.subjectId, day) + 1 > limit) {
    return false
  }
  if (ctx.maxConsec !== null && maxRunIfAdded(state, lesson.teacherId, day, [period], ctx) > ctx.maxConsec) {
    return false
  }
  return true
}

function canPlaceDouble(
  state: State,
  lesson: ValidationLesson,
  day: ScheduleDay,
  period: number,
  ctx: Ctx
): boolean {
  const dl = ctx.layout.get(day)
  if (!dl) return false
  if (!hasPeriod(dl, period) || !hasPeriod(dl, period + 1)) return false
  if (dl.groupIndex[period - 1] !== dl.groupIndex[period]) return false
  if (state.sectionSlot.has(key(lesson.sectionId, day, period))) return false
  if (state.sectionSlot.has(key(lesson.sectionId, day, period + 1))) return false
  if (state.teacherSlot.has(key(lesson.teacherId, day, period))) return false
  if (state.teacherSlot.has(key(lesson.teacherId, day, period + 1))) return false
  if ((state.teacherDay.get(key(lesson.teacherId, day)) ?? 0) + 2 > dl.dailyTeachingCap) return false
  if (ctx.maxWeekly !== null && (state.teacherWeek.get(lesson.teacherId) ?? 0) + 2 > ctx.maxWeekly) {
    return false
  }
  const limit = subjectDailyLimit(lesson.periodsPerWeek, ctx.enabledDayCount)
  if (occurrencesOnDay(state, lesson.sectionId, lesson.subjectId, day) + 1 > limit) {
    return false
  }
  if (ctx.maxConsec !== null && maxRunIfAdded(state, lesson.teacherId, day, [period, period + 1], ctx) > ctx.maxConsec) {
    return false
  }
  return true
}

// ─── heuristics ──────────────────────────────────────────────────────────────

function dayGaps(state: State, teacher: string, day: ScheduleDay, layout: Layout): number {
  let first = -1
  let last = -1
  let count = 0
  for (let p = 1; p <= layout.periodsPerDay; p++) {
    if (state.teacherSlot.has(key(teacher, day, p))) {
      if (first < 0) first = p
      last = p
      count++
    }
  }
  if (count === 0) return 0
  return last - first + 1 - count
}

function singlePenalty(
  state: State,
  lesson: ValidationLesson,
  day: ScheduleDay,
  period: number,
  ctx: Ctx
): number {
  const dl = ctx.layout.get(day)!
  let penalty = 0
  penalty +=
    ctx.weights.spreadSubjectAcrossWeek *
    (state.subjectDay.get(key(lesson.sectionId, lesson.subjectId, day)) ?? 0)
  penalty += SECTION_DAY_BALANCE * (state.sectionDay.get(key(lesson.sectionId, day)) ?? 0)
  penalty +=
    ctx.weights.varyPeriodPosition *
    (state.periodIndexCount.get(key(lessonKeyOf(lesson), period)) ?? 0)

  const before = dayGaps(state, lesson.teacherId, day, dl)
  const after = (() => {
    // Simulate adding this period by temporary marker.
    const marker = key(lesson.teacherId, day, period)
    const had = state.teacherSlot.has(marker)
    if (!had) state.teacherSlot.set(marker, EMPTY_ENTRY)
    const g = dayGaps(state, lesson.teacherId, day, dl)
    if (!had) state.teacherSlot.delete(marker)
    return g
  })()
  penalty += ctx.weights.teacherIdleGaps * Math.max(0, after - before)
  penalty += ctx.weights.teacherLoadBalance * (state.teacherDay.get(key(lesson.teacherId, day)) ?? 0)

  const run = maxRunIfAdded(state, lesson.teacherId, day, [period], ctx)
  penalty += ctx.weights.teacherRunLength * Math.max(0, run - 1)
  return penalty
}

const EMPTY_ENTRY: ScheduleEntry = {
  sectionId: '',
  gradeId: '',
  day: 'monday',
  period: 0,
  subjectId: '',
  teacherId: '',
  teachingAssignmentId: '',
  doubleGroupId: null,
}

// ─── placement ───────────────────────────────────────────────────────────────

interface PlacementResult {
  ok: boolean
  reason?: string
}

function chooseBestSingle(
  state: State,
  lesson: ValidationLesson,
  ctx: Ctx,
  rng: () => number
): { day: ScheduleDay; period: number } | null {
  let best: Array<{ day: ScheduleDay; period: number; penalty: number }> = []
  let bestPenalty = Infinity
  for (const slot of ctx.slots) {
    if (!canPlaceSingle(state, lesson, slot.day, slot.period, ctx)) continue
    const penalty = singlePenalty(state, lesson, slot.day, slot.period, ctx)
    if (penalty < bestPenalty - 1e-9) {
      bestPenalty = penalty
      best = [{ ...slot, penalty }]
    } else if (Math.abs(penalty - bestPenalty) <= 1e-9) {
      best.push({ ...slot, penalty })
    }
  }
  if (best.length === 0) return null
  const idx = Math.floor(rng() * best.length)
  return { day: best[idx].day, period: best[idx].period }
}

function chooseBestDouble(
  state: State,
  lesson: ValidationLesson,
  ctx: Ctx,
  rng: () => number
): { day: ScheduleDay; period: number } | null {
  let best: Array<{ day: ScheduleDay; period: number; penalty: number }> = []
  let bestPenalty = Infinity
  for (const slot of ctx.slots) {
    if (!canPlaceDouble(state, lesson, slot.day, slot.period, ctx)) continue
    const penalty =
      singlePenalty(state, lesson, slot.day, slot.period, ctx) +
      singlePenalty(state, lesson, slot.day, slot.period + 1, ctx)
    if (penalty < bestPenalty - 1e-9) {
      bestPenalty = penalty
      best = [{ ...slot, penalty }]
    } else if (Math.abs(penalty - bestPenalty) <= 1e-9) {
      best.push({ ...slot, penalty })
    }
  }
  if (best.length === 0) return null
  const idx = Math.floor(rng() * best.length)
  return { day: best[idx].day, period: best[idx].period }
}

function makeEntry(
  lesson: ValidationLesson,
  day: ScheduleDay,
  period: number,
  doubleGroupId: string | null
): ScheduleEntry {
  return {
    sectionId: lesson.sectionId,
    gradeId: lesson.gradeId,
    day,
    period,
    subjectId: lesson.subjectId,
    teacherId: lesson.teacherId,
    teachingAssignmentId: lesson.teachingAssignmentId,
    doubleGroupId,
    locked: false,
  }
}

function diagnoseSingle(state: State, lesson: ValidationLesson, ctx: Ctx): string {
  const reasons: Record<string, number> = {}
  const bump = (r: string) => (reasons[r] = (reasons[r] ?? 0) + 1)
  for (const slot of ctx.slots) {
    const dl = ctx.layout.get(slot.day)!
    if (!hasPeriod(dl, slot.period)) continue
    let blocked = false
    if (state.sectionSlot.has(key(lesson.sectionId, slot.day, slot.period))) {
      bump('NO_FREE_SECTION_SLOT')
      blocked = true
    }
    if (state.teacherSlot.has(key(lesson.teacherId, slot.day, slot.period))) {
      bump('TEACHER_BUSY')
      blocked = true
    }
    if (blocked) continue
    if ((state.teacherDay.get(key(lesson.teacherId, slot.day)) ?? 0) + 1 > dl.dailyTeachingCap) {
      bump('TEACHER_CAP_REACHED')
      continue
    }
    if (ctx.maxWeekly !== null && (state.teacherWeek.get(lesson.teacherId) ?? 0) + 1 > ctx.maxWeekly) {
      bump('TEACHER_CAP_REACHED')
      continue
    }
    const limit = subjectDailyLimit(lesson.periodsPerWeek, ctx.enabledDayCount)
    if (occurrencesOnDay(state, lesson.sectionId, lesson.subjectId, slot.day) + 1 > limit) {
      bump('SUBJECT_DAY_LIMIT')
      continue
    }
    if (ctx.maxConsec !== null && maxRunIfAdded(state, lesson.teacherId, slot.day, [slot.period], ctx) > ctx.maxConsec) {
      bump('TEACHER_CONSECUTIVE')
      continue
    }
  }
  let bestReason = 'NO_FEASIBLE_SLOT'
  let bestCount = 0
  for (const [r, c] of Object.entries(reasons)) {
    if (c > bestCount) {
      bestCount = c
      bestReason = r
    }
  }
  return bestReason
}

/**
 * Attempts to relocate an unlocked entry to any feasible slot for its lesson.
 * Returns true when the entry was moved. Depth-limited: it does not recurse.
 */
function relocateEntry(
  state: State,
  entry: ScheduleEntry,
  lesson: ValidationLesson,
  ctx: Ctx,
  rng: () => number
): boolean {
  const original = { day: entry.day, period: entry.period }
  removeEntry(state, entry)
  const best = chooseBestSingle(state, lesson, ctx, rng)
  if (best) {
    addEntry(state, { ...entry, day: best.day, period: best.period })
    return true
  }
  addEntry(state, { ...entry, day: original.day, period: original.period })
  return false
}

function tryPlaceSingle(
  state: State,
  lesson: ValidationLesson,
  ctx: Ctx,
  rng: () => number,
  lessonById: Map<string, ValidationLesson>
): PlacementResult {
  const best = chooseBestSingle(state, lesson, ctx, rng)
  if (best) {
    addEntry(state, makeEntry(lesson, best.day, best.period, null))
    return { ok: true }
  }

  // Depth-limited repair: move a single blocking entry out of the way.
  for (const slot of ctx.slots) {
    const sb = state.sectionSlot.get(key(lesson.sectionId, slot.day, slot.period))
    const tb = state.teacherSlot.get(key(lesson.teacherId, slot.day, slot.period))
    if (!sb && !tb) continue
    const blocker = sb ?? tb!
    if (blocker.locked || blocker.doubleGroupId) continue
    const blockerLesson = lessonById.get(key(blocker.sectionId, blocker.subjectId))
    if (!blockerLesson) continue
    if (relocateEntry(state, blocker, blockerLesson, ctx, rng)) {
      if (canPlaceSingle(state, lesson, slot.day, slot.period, ctx)) {
        addEntry(state, makeEntry(lesson, slot.day, slot.period, null))
        return { ok: true }
      }
      // Relocation happened but did not help here; keep going.
    }
  }

  return { ok: false, reason: diagnoseSingle(state, lesson, ctx) }
}

function tryPlaceDouble(
  state: State,
  lesson: ValidationLesson,
  ctx: Ctx,
  rng: () => number,
  doubleCounter: { n: number }
): PlacementResult {
  const best = chooseBestDouble(state, lesson, ctx, rng)
  if (best) {
    const groupId = `${lesson.lessonId}#d${doubleCounter.n++}`
    addEntry(state, makeEntry(lesson, best.day, best.period, groupId))
    addEntry(state, makeEntry(lesson, best.day, best.period + 1, groupId))
    return { ok: true }
  }
  return { ok: false, reason: 'NO_DOUBLE_BLOCK' }
}

// ─── soft score ──────────────────────────────────────────────────────────────

function evaluate(state: State, ctx: Ctx, lessons: ValidationLesson[]): SoftWeights {
  const w = ctx.weights

  // spread + position variety per lesson
  const daily = new Map<string, Map<ScheduleDay, number>>()
  const periodHist = new Map<string, Map<number, number>>()
  for (const entry of state.sectionSlot.values()) {
    const lk = key(entry.sectionId, entry.subjectId)
    if (!daily.has(lk)) daily.set(lk, new Map())
    daily.get(lk)!.set(entry.day, (daily.get(lk)!.get(entry.day) ?? 0) + 1)
    if (!periodHist.has(lk)) periodHist.set(lk, new Map())
    periodHist.get(lk)!.set(entry.period, (periodHist.get(lk)!.get(entry.period) ?? 0) + 1)
  }

  let spread = 0
  let position = 0
  for (const lesson of lessons) {
    const lk = lessonKeyOf(lesson)
    const dm = daily.get(lk)
    if (ctx.enabledDayCount > 0) {
      const total = lesson.periodsPerWeek
      const mean = total / ctx.enabledDayCount
      let variance = 0
      for (const day of ctx.enabledDays) variance += Math.pow((dm?.get(day) ?? 0) - mean, 2)
      spread += variance
    }
    const ph = periodHist.get(lk)
    if (ph) {
      for (const c of ph.values()) position += Math.max(0, c - 1)
    }
  }

  // teacher idle gaps, load balance, run length
  const teacherDays = new Map<string, Map<ScheduleDay, number[]>>()
  for (const entry of state.teacherSlot.values()) {
    if (!teacherDays.has(entry.teacherId)) teacherDays.set(entry.teacherId, new Map())
    const byDay = teacherDays.get(entry.teacherId)!
    if (!byDay.has(entry.day)) byDay.set(entry.day, [])
    byDay.get(entry.day)!.push(entry.period)
  }

  let gaps = 0
  let balance = 0
  let runs = 0
  for (const [, byDay] of teacherDays) {
    const counts: number[] = []
    for (const day of ctx.enabledDays) {
      const periods = (byDay.get(day) ?? []).slice().sort((a, b) => a - b)
      counts.push(periods.length)
      const dl = ctx.layout.get(day)
      if (periods.length > 0 && dl) {
        let run = 0
        for (let p = 1; p <= dl.periodsPerDay; p++) {
          if (periods.includes(p)) {
            run++
          } else {
            if (run > 0) runs += Math.pow(run - 1, 2)
            run = 0
          }
        }
        if (run > 0) runs += Math.pow(run - 1, 2)
        gaps += periods[periods.length - 1] - periods[0] + 1 - periods.length
      }
    }
    if (counts.length > 0) {
      const mean = counts.reduce((s, c) => s + c, 0) / counts.length
      for (const c of counts) balance += Math.pow(c - mean, 2)
    }
  }

  return {
    spreadSubjectAcrossWeek: spread * w.spreadSubjectAcrossWeek,
    varyPeriodPosition: position * w.varyPeriodPosition,
    teacherIdleGaps: gaps * w.teacherIdleGaps,
    teacherLoadBalance: balance * w.teacherLoadBalance,
    teacherRunLength: runs * w.teacherRunLength,
  }
}

function totalScore(breakdown: SoftWeights): number {
  return (
    breakdown.spreadSubjectAcrossWeek +
    breakdown.varyPeriodPosition +
    breakdown.teacherIdleGaps +
    breakdown.teacherLoadBalance +
    breakdown.teacherRunLength
  )
}

// ─── construction ────────────────────────────────────────────────────────────

interface ConstructResult {
  state: State
  unplacedByLesson: Map<string, Map<string, number>>
}

function sortLessons(
  lessons: ValidationLesson[],
  demandByTeacher: Map<string, number>,
  capacityByTeacher: Map<string, number>
): ValidationLesson[] {
  return lessons.slice().sort((a, b) => {
    const ua = (demandByTeacher.get(a.teacherId) ?? 0) / (capacityByTeacher.get(a.teacherId) ?? 1)
    const ub = (demandByTeacher.get(b.teacherId) ?? 0) / (capacityByTeacher.get(b.teacherId) ?? 1)
    if (ub !== ua) return ub - ua
    const da = a.doublePeriod === 'required' ? 0 : a.doublePeriod === 'allowed' ? 1 : 2
    const db = b.doublePeriod === 'required' ? 0 : b.doublePeriod === 'allowed' ? 1 : 2
    if (da !== db) return da - db
    if (b.periodsPerWeek !== a.periodsPerWeek) return b.periodsPerWeek - a.periodsPerWeek
    return a.lessonId < b.lessonId ? -1 : a.lessonId > b.lessonId ? 1 : 0
  })
}

function construct(
  input: SolverInput,
  ctx: Ctx,
  lessonById: Map<string, ValidationLesson>,
  rng: () => number,
  deadline: number,
  progress: { timedOut: boolean }
): ConstructResult {
  const state = newState()
  const unplacedByLesson = new Map<string, Map<string, number>>()

  for (const entry of input.lockedEntries ?? []) {
    addEntry(state, { ...entry, locked: true })
  }

  const demandByTeacher = new Map<string, number>()
  for (const l of input.lessons) {
    demandByTeacher.set(l.teacherId, (demandByTeacher.get(l.teacherId) ?? 0) + l.periodsPerWeek)
  }
  const capacityByTeacher = new Map<string, number>()
  const dailyTotal = ctx.settings.perDay.reduce((s, d) => s + Math.max(0, d.dailyTeachingCap), 0)
  for (const l of input.lessons) {
    if (capacityByTeacher.has(l.teacherId)) continue
    const cap = ctx.maxWeekly === null ? dailyTotal : Math.min(ctx.maxWeekly, dailyTotal)
    capacityByTeacher.set(l.teacherId, cap)
  }

  const ordered = sortLessons(input.lessons, demandByTeacher, capacityByTeacher)
  const doubleCounter = { n: 0 }

  const recordUnplaced = (lk: string, reason: string, count: number) => {
    if (!unplacedByLesson.has(lk)) unplacedByLesson.set(lk, new Map())
    const m = unplacedByLesson.get(lk)!
    m.set(reason, (m.get(reason) ?? 0) + count)
  }

  for (let idx = 0; idx < ordered.length; idx++) {
    if (progress.timedOut) break
    if ((idx & 31) === 0 && Date.now() > deadline) {
      progress.timedOut = true
      break
    }
    const lesson = ordered[idx]
    const lk = lessonKeyOf(lesson)
    let remaining = lesson.periodsPerWeek - (state.lessonCount.get(lk) ?? 0)
    if (remaining <= 0) continue

    const requiresDouble = lesson.doublePeriod === 'required'
    let hasDouble = (state.doubleGroupsByLesson.get(lk)?.size ?? 0) > 0

    if (requiresDouble && !hasDouble && remaining >= 2) {
      const res = tryPlaceDouble(state, lesson, ctx, rng, doubleCounter)
      if (res.ok) {
        remaining -= 2
        hasDouble = true
      }
    }

    // A required double that cannot be placed at all leaves the lesson
    // unsatisfiable: report it as unplaced instead of placing singles that
    // would violate the required-double rule.
    if (requiresDouble && !hasDouble) {
      recordUnplaced(lk, 'NO_DOUBLE_BLOCK', remaining)
      continue
    }

    while (remaining > 0) {
      if (Date.now() > deadline) {
        progress.timedOut = true
        break
      }
      const res = tryPlaceSingle(state, lesson, ctx, rng, lessonById)
      if (res.ok) {
        remaining--
      } else {
        recordUnplaced(lk, res.reason ?? 'NO_FEASIBLE_SLOT', remaining)
        remaining = 0
      }
    }
  }

  return { state, unplacedByLesson }
}

// ─── ejection-chain fill pass ─────────────────────────────────────────────────
//
// Greedy construction can leave a few lessons unplaced in tight, but feasible,
// schools because the section grid and teacher rows are nearly full. This pass
// relocates already-placed entries (bounded depth) to open a slot for an
// unplaced lesson. It only ever increases the number of placed periods.

const EJECT_CANDIDATES = 10
const EJECT_DEPTH = 3
const DOUBLE_EJECT_DEPTH = 2
const FILL_MAX_ATTEMPTS = 120000

interface EjectBudget {
  attempts: number
  maxAttempts: number
  deadline: number
  timedOut: boolean
}

type JournalOp = () => void

function undoTo(journal: JournalOp[], mark: number): void {
  while (journal.length > mark) journal.pop()!()
}

function addJ(state: State, journal: JournalOp[], entry: ScheduleEntry): void {
  addEntry(state, entry)
  journal.push(() => removeEntry(state, entry))
}

function removeJ(state: State, journal: JournalOp[], entry: ScheduleEntry): void {
  removeEntry(state, entry)
  journal.push(() => addEntry(state, entry))
}

function uniqueBlockers(list: Array<ScheduleEntry | undefined>): ScheduleEntry[] {
  const out: ScheduleEntry[] = []
  for (const e of list) {
    if (e && !e.locked && !e.doubleGroupId && !out.includes(e)) out.push(e)
  }
  return out
}

function orderCandidates(
  state: State,
  lesson: ValidationLesson,
  ctx: Ctx,
  limit: number
): Array<{ day: ScheduleDay; period: number }> {
  const scored = ctx.slots.map((s) => ({
    day: s.day,
    period: s.period,
    pen: singlePenalty(state, lesson, s.day, s.period, ctx),
  }))
  scored.sort((a, b) => a.pen - b.pen)
  return scored.slice(0, limit).map((s) => ({ day: s.day, period: s.period }))
}

/** Places `lesson` at `slot`, ejecting (and rehoming) blockers when needed. */
function ejectInsert(
  state: State,
  journal: JournalOp[],
  lessonById: Map<string, ValidationLesson>,
  lesson: ValidationLesson,
  slot: { day: ScheduleDay; period: number },
  depth: number,
  ctx: Ctx,
  budget: EjectBudget
): boolean {
  if (budget.timedOut) return false
  if (budget.attempts >= budget.maxAttempts) return false
  budget.attempts++
  if (depth < 0) return false
  if (Date.now() > budget.deadline) {
    budget.timedOut = true
    return false
  }

  if (canPlaceSingle(state, lesson, slot.day, slot.period, ctx)) {
    addJ(state, journal, makeEntry(lesson, slot.day, slot.period, null))
    return true
  }

  const sb = state.sectionSlot.get(key(lesson.sectionId, slot.day, slot.period))
  const tb = state.teacherSlot.get(key(lesson.teacherId, slot.day, slot.period))
  const blockers = uniqueBlockers([sb, tb])

  for (const blocker of blockers) {
    const mark = journal.length
    removeJ(state, journal, blocker)
    const blockerLesson = lessonById.get(key(blocker.sectionId, blocker.subjectId))
    let placed = false
    if (blockerLesson) {
      for (const cs of orderCandidates(state, blockerLesson, ctx, EJECT_CANDIDATES)) {
        if (cs.day === slot.day && cs.period === slot.period) continue
        const cm = journal.length
        if (ejectInsert(state, journal, lessonById, blockerLesson, cs, depth - 1, ctx, budget)) {
          placed = true
          break
        }
        undoTo(journal, cm)
        if (budget.timedOut) break
      }
    }
    if (placed && canPlaceSingle(state, lesson, slot.day, slot.period, ctx)) {
      addJ(state, journal, makeEntry(lesson, slot.day, slot.period, null))
      return true
    }
    undoTo(journal, mark)
    if (budget.timedOut) return false
  }
  return false
}

/** Frees one section+teacher cell by rehoming its occupants (bounded depth). */
function forceFreeCell(
  state: State,
  journal: JournalOp[],
  lessonById: Map<string, ValidationLesson>,
  sectionId: string,
  teacherId: string,
  day: ScheduleDay,
  period: number,
  depth: number,
  ctx: Ctx,
  budget: EjectBudget
): boolean {
  if (budget.timedOut) return false
  if (budget.attempts >= budget.maxAttempts) return false
  budget.attempts++
  if (Date.now() > budget.deadline) {
    budget.timedOut = true
    return false
  }

  const sb = state.sectionSlot.get(key(sectionId, day, period))
  const tb = state.teacherSlot.get(key(teacherId, day, period))
  if (!sb && !tb) return true
  if (depth < 0) return false

  const blockers = uniqueBlockers([sb, tb])
  if (blockers.length === 0) return false

  const blocker = blockers[0]
  const mark = journal.length
  removeJ(state, journal, blocker)
  const blockerLesson = lessonById.get(key(blocker.sectionId, blocker.subjectId))
  let placed = false
  if (blockerLesson) {
    for (const cs of orderCandidates(state, blockerLesson, ctx, EJECT_CANDIDATES)) {
      if (cs.day === day && cs.period === period) continue
      const cm = journal.length
      if (ejectInsert(state, journal, lessonById, blockerLesson, cs, depth - 1, ctx, budget)) {
        placed = true
        break
      }
      undoTo(journal, cm)
      if (budget.timedOut) break
    }
  }
  if (placed && forceFreeCell(state, journal, lessonById, sectionId, teacherId, day, period, depth - 1, ctx, budget)) {
    return true
  }
  undoTo(journal, mark)
  return false
}

function doubleBaseSlots(ctx: Ctx): Array<{ day: ScheduleDay; period: number }> {
  const out: Array<{ day: ScheduleDay; period: number }> = []
  for (const slot of ctx.slots) {
    const dl = ctx.layout.get(slot.day)
    if (!dl) continue
    if (slot.period + 1 > dl.periodsPerDay) continue
    if (dl.groupIndex[slot.period - 1] === dl.groupIndex[slot.period]) out.push(slot)
  }
  return out
}

function placeDoubleWithEjection(
  state: State,
  journal: JournalOp[],
  lessonById: Map<string, ValidationLesson>,
  lesson: ValidationLesson,
  ctx: Ctx,
  rng: () => number,
  budget: EjectBudget,
  doubleCounter: { n: number }
): boolean {
  if (budget.timedOut) return false
  const direct = chooseBestDouble(state, lesson, ctx, rng)
  if (direct) {
    const gid = `${lesson.lessonId}#f${doubleCounter.n++}`
    addJ(state, journal, makeEntry(lesson, direct.day, direct.period, gid))
    addJ(state, journal, makeEntry(lesson, direct.day, direct.period + 1, gid))
    return true
  }

  for (const base of doubleBaseSlots(ctx)) {
    if (budget.timedOut || budget.attempts >= budget.maxAttempts) break
    const mark = journal.length
    const ok =
      forceFreeCell(state, journal, lessonById, lesson.sectionId, lesson.teacherId, base.day, base.period, DOUBLE_EJECT_DEPTH, ctx, budget) &&
      forceFreeCell(state, journal, lessonById, lesson.sectionId, lesson.teacherId, base.day, base.period + 1, DOUBLE_EJECT_DEPTH, ctx, budget) &&
      canPlaceDouble(state, lesson, base.day, base.period, ctx)
    if (ok) {
      const gid = `${lesson.lessonId}#f${doubleCounter.n++}`
      addJ(state, journal, makeEntry(lesson, base.day, base.period, gid))
      addJ(state, journal, makeEntry(lesson, base.day, base.period + 1, gid))
      return true
    }
    undoTo(journal, mark)
  }
  return false
}

/**
 * Attempts to place every still-unplaced lesson by ejecting already-placed
 * entries. Runs once on the best construction and only adds periods.
 */
function fillUnplaced(
  state: State,
  lessons: ValidationLesson[],
  lessonById: Map<string, ValidationLesson>,
  ctx: Ctx,
  rng: () => number,
  deadline: number,
  progress: { timedOut: boolean }
): void {
  const budget: EjectBudget = {
    attempts: 0,
    maxAttempts: FILL_MAX_ATTEMPTS,
    deadline,
    timedOut: false,
  }
  const journal: JournalOp[] = []
  const doubleCounter = { n: 0 }

  const targets = lessons
    .filter((l) => (l.periodsPerWeek - (state.lessonCount.get(lessonKeyOf(l)) ?? 0)) > 0)
    .sort((a, b) => b.periodsPerWeek - a.periodsPerWeek)

  for (const lesson of targets) {
    if (budget.timedOut || budget.attempts >= budget.maxAttempts) break
    if (Date.now() > deadline) {
      budget.timedOut = true
      break
    }
    const lk = lessonKeyOf(lesson)
    let remaining = lesson.periodsPerWeek - (state.lessonCount.get(lk) ?? 0)
    const requiresDouble = lesson.doublePeriod === 'required'
    let hasDouble = (state.doubleGroupsByLesson.get(lk)?.size ?? 0) > 0

    if (requiresDouble && !hasDouble && remaining >= 2) {
      if (placeDoubleWithEjection(state, journal, lessonById, lesson, ctx, rng, budget, doubleCounter)) {
        remaining -= 2
        hasDouble = true
      }
    }
    if (requiresDouble && !hasDouble) continue

    while (remaining > 0 && !budget.timedOut && budget.attempts < budget.maxAttempts) {
      let done = false
      for (const slot of orderCandidates(state, lesson, ctx, EJECT_CANDIDATES + 6)) {
        if (budget.timedOut) break
        const mark = journal.length
        if (ejectInsert(state, journal, lessonById, lesson, slot, EJECT_DEPTH, ctx, budget)) {
          done = true
          break
        }
        undoTo(journal, mark)
      }
      if (!done) break
      remaining--
    }
  }
  if (budget.timedOut) progress.timedOut = true
}

// ─── local search ────────────────────────────────────────────────────────────

function snapshotEntry(entry: ScheduleEntry): { day: ScheduleDay; period: number } {
  return { day: entry.day, period: entry.period }
}

type Undo = () => void

function tryMoveSingle(
  state: State,
  entry: ScheduleEntry,
  lesson: ValidationLesson,
  target: { day: ScheduleDay; period: number },
  ctx: Ctx
): Undo | null {
  const from = snapshotEntry(entry)
  removeEntry(state, entry)
  if (canPlaceSingle(state, lesson, target.day, target.period, ctx)) {
    addEntry(state, { ...entry, day: target.day, period: target.period })
    return () => {
      removeEntry(state, { ...entry, day: target.day, period: target.period })
      addEntry(state, { ...entry, day: from.day, period: from.period })
    }
  }
  addEntry(state, { ...entry, day: from.day, period: from.period })
  return null
}

function tryMoveDouble(
  state: State,
  group: ScheduleEntry[],
  lesson: ValidationLesson,
  target: { day: ScheduleDay; period: number },
  ctx: Ctx
): Undo | null {
  if (group.length !== 2) return null
  const from = group.map(snapshotEntry)
  for (const e of group) removeEntry(state, e)
  if (canPlaceDouble(state, lesson, target.day, target.period, ctx)) {
    const gid = group[0].doubleGroupId
    const moved: ScheduleEntry[] = [
      { ...group[0], day: target.day, period: target.period, doubleGroupId: gid },
      { ...group[1], day: target.day, period: target.period + 1, doubleGroupId: gid },
    ]
    addEntry(state, moved[0])
    addEntry(state, moved[1])
    return () => {
      removeEntry(state, moved[0])
      removeEntry(state, moved[1])
      group.forEach((e, i) => addEntry(state, { ...e, day: from[i].day, period: from[i].period }))
    }
  }
  group.forEach((e, i) => addEntry(state, { ...e, day: from[i].day, period: from[i].period }))
  return null
}

function trySwap(
  state: State,
  a: ScheduleEntry,
  b: ScheduleEntry,
  lessonA: ValidationLesson,
  lessonB: ValidationLesson,
  ctx: Ctx
): Undo | null {
  if (a.locked || b.locked) return null
  if (a.doubleGroupId || b.doubleGroupId) return null
  const posA = snapshotEntry(a)
  const posB = snapshotEntry(b)
  if (posA.day === posB.day && posA.period === posB.period) return null
  removeEntry(state, a)
  removeEntry(state, b)
  const aToB = canPlaceSingle(state, lessonA, posB.day, posB.period, ctx)
  if (!aToB) {
    addEntry(state, { ...a, day: posA.day, period: posA.period })
    addEntry(state, { ...b, day: posB.day, period: posB.period })
    return null
  }
  addEntry(state, { ...a, day: posB.day, period: posB.period })
  const bToA = canPlaceSingle(state, lessonB, posA.day, posA.period, ctx)
  if (!bToA) {
    removeEntry(state, { ...a, day: posB.day, period: posB.period })
    addEntry(state, { ...a, day: posA.day, period: posA.period })
    addEntry(state, { ...b, day: posB.day, period: posB.period })
    return null
  }
  addEntry(state, { ...b, day: posA.day, period: posA.period })
  return () => {
    removeEntry(state, { ...a, day: posB.day, period: posB.period })
    removeEntry(state, { ...b, day: posA.day, period: posA.period })
    addEntry(state, { ...a, day: posA.day, period: posA.period })
    addEntry(state, { ...b, day: posB.day, period: posB.period })
  }
}

function localSearch(
  state: State,
  ctx: Ctx,
  lessons: ValidationLesson[],
  lessonById: Map<string, ValidationLesson>,
  rng: () => number,
  maxIterations: number,
  deadline: number,
  progress: { iterations: number; timedOut: boolean }
): { score: number } {
  let score = totalScore(evaluate(state, ctx, lessons))

  for (let i = 0; i < maxIterations; i++) {
    if (progress.timedOut) break
    if ((i & 31) === 0 && Date.now() > deadline) {
      progress.timedOut = true
      break
    }
    progress.iterations++

    const movable = Array.from(state.sectionSlot.values()).filter((e) => !e.locked)
    if (movable.length === 0) break
    const pick = movable[Math.floor(rng() * movable.length)]
    const target = ctx.slots[Math.floor(rng() * ctx.slots.length)]
    const lesson = lessonById.get(key(pick.sectionId, pick.subjectId))
    if (!lesson) continue

    let undo: Undo | null = null
    if (pick.doubleGroupId) {
      const group = Array.from(state.sectionSlot.values()).filter(
        (e) => e.doubleGroupId === pick.doubleGroupId
      )
      if (group.some((e) => e.locked)) continue
      if (target.day === pick.day && (target.period === pick.period || target.period + 1 === pick.period)) {
        continue
      }
      undo = tryMoveDouble(state, group, lesson, target, ctx)
    } else if (rng() < 0.35) {
      // occasional swap with another unlocked single entry
      const other = movable[Math.floor(rng() * movable.length)]
      if (other !== pick && !other.doubleGroupId && other.sectionId !== pick.sectionId) {
        const otherLesson = lessonById.get(key(other.sectionId, other.subjectId))
        if (otherLesson) undo = trySwap(state, pick, other, lesson, otherLesson, ctx)
      }
      if (!undo) undo = tryMoveSingle(state, pick, lesson, target, ctx)
    } else {
      undo = tryMoveSingle(state, pick, lesson, target, ctx)
    }
    if (!undo) continue

    const after = totalScore(evaluate(state, ctx, lessons))
    if (after < score - 1e-9) {
      score = after
    } else {
      undo()
    }
  }

  return { score }
}

// ─── invariant check (compact, self-contained) ───────────────────────────────

function countHardViolations(entries: ScheduleEntry[], ctx: Ctx, lessons: ValidationLesson[]): number {
  let violations = 0
  const sectionSlot = new Set<string>()
  const teacherSlot = new Set<string>()
  const weekly = new Map<string, number>()
  const tDay = new Map<string, number>()
  const tWeek = new Map<string, number>()
  const subjDay = new Map<string, number>()
  const subjDayGroups = new Map<string, Set<string>>()
  const doubleGroups = new Map<string, ScheduleEntry[]>()

  for (const e of entries) {
    const ss = key(e.sectionId, e.day, e.period)
    if (sectionSlot.has(ss)) violations++
    sectionSlot.add(ss)
    const ts = key(e.teacherId, e.day, e.period)
    if (teacherSlot.has(ts)) violations++
    teacherSlot.add(ts)
    weekly.set(key(e.sectionId, e.subjectId), (weekly.get(key(e.sectionId, e.subjectId)) ?? 0) + 1)
    tDay.set(key(e.teacherId, e.day), (tDay.get(key(e.teacherId, e.day)) ?? 0) + 1)
    tWeek.set(e.teacherId, (tWeek.get(e.teacherId) ?? 0) + 1)
    const sdKey = key(e.sectionId, e.subjectId, e.day)
    subjDay.set(sdKey, (subjDay.get(sdKey) ?? 0) + 1)
    if (e.doubleGroupId) {
      if (!doubleGroups.has(e.doubleGroupId)) doubleGroups.set(e.doubleGroupId, [])
      doubleGroups.get(e.doubleGroupId)!.push(e)
      if (!subjDayGroups.has(sdKey)) subjDayGroups.set(sdKey, new Set())
      subjDayGroups.get(sdKey)!.add(e.doubleGroupId)
    }
  }

  for (const l of lessons) {
    const c = weekly.get(lessonKeyOf(l)) ?? 0
    if (c > l.periodsPerWeek) violations++
    const limit = subjectDailyLimit(l.periodsPerWeek, ctx.enabledDayCount)
    for (const day of ctx.enabledDays) {
      const kd = key(l.sectionId, l.subjectId, day)
      const occ = (subjDay.get(kd) ?? 0) - (subjDayGroups.get(kd)?.size ?? 0)
      if (occ > limit) violations++
    }
  }
  for (const [kd, count] of tDay) {
    const [teacherId, day] = kd.split(SEP)
    const dl = ctx.layout.get(day as ScheduleDay)
    if (dl && count > dl.dailyTeachingCap && teacherId) violations++
  }
  if (ctx.maxWeekly !== null) {
    for (const c of tWeek.values()) if (c > ctx.maxWeekly) violations++
  }
  for (const [, list] of doubleGroups) {
    if (list.length !== 2) {
      violations++
      continue
    }
    const [a, b] = list
    const dl = ctx.layout.get(a.day)
    if (
      a.day !== b.day ||
      Math.abs(a.period - b.period) !== 1 ||
      !dl ||
      dl.groupIndex[a.period - 1] !== dl.groupIndex[b.period - 1] ||
      a.sectionId !== b.sectionId ||
      a.subjectId !== b.subjectId
    ) {
      violations++
    }
  }
  return violations
}

// ─── public API ──────────────────────────────────────────────────────────────

export function solveSchedule(input: SolverInput): SolverOutput {
  const started = Date.now()
  const deadline = started + Math.max(0, input.timeBudgetMs)
  const ctx = buildCtx(input)
  const lessonById = new Map<string, ValidationLesson>()
  for (const l of input.lessons) lessonById.set(lessonKeyOf(l), l)

  const restarts = Math.max(1, Math.min(5, Math.floor(input.iterationBudget / 200) || 1))
  const perRestart = Math.max(1, Math.floor(input.iterationBudget / restarts))

  let bestState: State | null = null
  let bestUnplaced = new Map<string, Map<string, number>>()
  let bestScore = Infinity
  let bestUnplacedPeriods = Infinity

  const progress = { iterations: 0, timedOut: false }
  let restartsDone = 0

  for (let r = 0; r < restarts; r++) {
    if (progress.timedOut) break
    const rng = mulberry32((input.seed + r * 0x9e3779b9) >>> 0)
    const { state, unplacedByLesson } = construct(input, ctx, lessonById, rng, deadline, progress)
    restartsDone++

    if (!progress.timedOut) {
      localSearch(state, ctx, input.lessons, lessonById, rng, perRestart, deadline, progress)
    }

    // compute unplaced periods for this restart
    let unplacedPeriods = 0
    for (const lesson of input.lessons) {
      const placed = state.lessonCount.get(lessonKeyOf(lesson)) ?? 0
      unplacedPeriods += Math.max(0, lesson.periodsPerWeek - placed)
    }
    const breakdown = evaluate(state, ctx, input.lessons)
    const score = totalScore(breakdown)

    if (
      unplacedPeriods < bestUnplacedPeriods ||
      (unplacedPeriods === bestUnplacedPeriods && score < bestScore)
    ) {
      bestState = state
      bestUnplaced = unplacedByLesson
      bestScore = score
      bestUnplacedPeriods = unplacedPeriods
    }
    if (progress.timedOut) break
  }

  // Try to place anything still unplaced on the best construction, then let the
  // local search polish the (now more complete) schedule if budget remains.
  if (bestState && !progress.timedOut) {
    const beforeUnplaced = input.lessons.reduce(
      (sum, l) => sum + Math.max(0, l.periodsPerWeek - (bestState.lessonCount.get(lessonKeyOf(l)) ?? 0)),
      0
    )
    if (beforeUnplaced > 0) {
      const fillRng = mulberry32((input.seed ^ 0x5bd1e995) >>> 0)
      fillUnplaced(bestState, input.lessons, lessonById, ctx, fillRng, deadline, progress)
    }
  }

  const finalState = bestState ?? newState()
  const entries = Array.from(finalState.sectionSlot.values())
    .map((e) => ({ ...e, locked: !!e.locked }))
    .sort((a, b) => {
      if (a.sectionId !== b.sectionId) return a.sectionId < b.sectionId ? -1 : 1
      const da = ctx.enabledDays.indexOf(a.day)
      const db = ctx.enabledDays.indexOf(b.day)
      if (da !== db) return da - db
      if (a.period !== b.period) return a.period - b.period
      return 0
    })

  const unplaced: UnplacedLesson[] = []
  for (const lesson of input.lessons) {
    const placed = finalState.lessonCount.get(lessonKeyOf(lesson)) ?? 0
    const shortfall = Math.max(0, lesson.periodsPerWeek - placed)
    if (shortfall === 0) continue
    const reasonsMap = bestUnplaced.get(lessonKeyOf(lesson)) ?? new Map<string, number>()
    if (reasonsMap.size === 0) reasonsMap.set('NO_FEASIBLE_SLOT', shortfall)
    const reasons: Record<string, number> = {}
    for (const [rk, rv] of reasonsMap) reasons[rk] = rv
    const reason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'NO_FEASIBLE_SLOT'
    unplaced.push({
      lessonId: lesson.lessonId,
      sectionId: lesson.sectionId,
      gradeId: lesson.gradeId,
      subjectId: lesson.subjectId,
      teacherId: lesson.teacherId,
      periods: shortfall,
      reason,
      reasons,
    })
  }

  const breakdown = evaluate(finalState, ctx, input.lessons)

  return {
    entries,
    unplaced,
    stats: {
      seed: input.seed,
      restarts: restartsDone,
      iterations: progress.iterations,
      elapsedMs: Date.now() - started,
      timedOut: progress.timedOut,
      hardViolations: countHardViolations(entries, ctx, input.lessons),
      softScore: totalScore(breakdown),
      softBreakdown: breakdown,
    },
  }
}
