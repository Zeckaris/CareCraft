/**
 * sectionPlanning.util.ts
 *
 * Pure helpers for planning automatic section generation.
 *
 * The sizing logic is intentionally dependency-free so it can be unit tested
 * and reasoned about in isolation from the database.
 *
 * Sizing priority (highest first):
 *   1. never exceed max
 *   2. respect min
 *   3. stay as close to target as possible
 * If all three cannot be satisfied the best possible plan is returned together
 * with a warning string.
 */

export interface SizePlan {
  sizes: number[]
  warning?: string
}

/** Fills `count` sections to `target`; the last holds the remainder. */
function fillToTarget(total: number, target: number, count: number): number[] {
  const sizes = new Array(count).fill(target)
  sizes[count - 1] = total - (count - 1) * target
  return sizes
}

/** Splits `total` into `count` sections that differ by at most one. */
function balancedSizes(total: number, count: number): number[] {
  const base = Math.floor(total / count)
  const remainder = total % count
  const sizes: number[] = []
  for (let i = 0; i < count; i++) sizes.push(i < remainder ? base + 1 : base)
  return sizes
}

/**
 * Plans how many students go into each generated section.
 *
 * @param total  number of unassigned active students
 * @param target desired section size (min <= target <= max)
 * @param min    minimum acceptable section size
 * @param max    maximum acceptable section size
 */
export function planSectionSizes(
  total: number,
  target: number,
  min: number,
  max: number
): SizePlan {
  if (total <= 0) {
    return { sizes: [], warning: 'No unassigned active students found.' }
  }

  // Fewer students than the minimum: still create the first section.
  if (total < min) {
    return {
      sizes: [total],
      warning: `Only ${total} student(s) available, which is below the minimum section size of ${min}. A single section was created.`,
    }
  }

  // Hard lower bound: enough sections that none exceeds max.
  const minSectionsForMax = Math.ceil(total / max)
  // Largest count where every section can still meet min.
  const maxSectionsForMin = Math.floor(total / min)

  const preferredCount = Math.max(1, Math.ceil(total / target))
  const filled = fillToTarget(total, target, preferredCount)
  const remainder = filled[filled.length - 1]

  // Default: fill to target, last section holds the remainder.
  if (remainder >= min) {
    return { sizes: filled }
  }

  // Remainder is below min. First try to absorb it by dropping the last section
  // (distributing its students across the rest) as long as nobody exceeds max.
  if (preferredCount - 1 >= minSectionsForMax && total <= (preferredCount - 1) * max) {
    return { sizes: balancedSizes(total, preferredCount - 1) }
  }

  // Otherwise rebalance across the sections, reducing the count when that is
  // what it takes to bring every section back to at least min.
  let sections = preferredCount
  let warning: string | undefined

  if (total < sections * min) {
    if (maxSectionsForMin >= minSectionsForMax) {
      sections = maxSectionsForMin
    } else {
      // min and max are mutually impossible; max wins.
      sections = minSectionsForMax
      warning = `Cannot satisfy both the minimum (${min}) and maximum (${max}) section size for ${total} student(s). The maximum was respected and the minimum was relaxed.`
    }
  }

  const sizes = balancedSizes(total, sections)

  if (!warning && sizes.some((s) => s < min || s > max)) {
    warning = `Could not fully satisfy the requested minimum (${min}) and maximum (${max}) section size for ${total} student(s); produced the closest possible distribution.`
  }

  return { sizes, warning }
}

/**
 * Distribution strategy: randomly spreads students across the planned sections.
 *
 * This is deliberately the ONLY place student-to-section placement happens so a
 * results-based balancing strategy can replace it later without touching the
 * generate controller.
 *
 * @param students flat list of students (in any order)
 * @param sizes    section sizes whose sum equals students.length
 * @returns        one array of students per section, in the same order as sizes
 */
export function distributeStudentsRandomly<T>(students: T[], sizes: number[]): T[][] {
  const shuffled = [...students]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const groups: T[][] = []
  let cursor = 0
  for (const size of sizes) {
    groups.push(shuffled.slice(cursor, cursor + size))
    cursor += size
  }
  return groups
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** 0 -> "A", 25 -> "Z", 26 -> "AA", 27 -> "AB", ... */
export function sectionNameAt(index: number): string {
  let n = index
  let name = ''
  do {
    name = ALPHABET[n % 26] + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

/**
 * Returns `count` alphabet section names skipping any already taken.
 * e.g. taken = { A, B }, count = 2  =>  ["C", "D"]
 */
export function buildSectionNames(count: number, taken: Set<string>): string[] {
  const names: string[] = []
  let index = 0
  while (names.length < count) {
    const name = sectionNameAt(index)
    if (!taken.has(name)) names.push(name)
    index++
  }
  return names
}
