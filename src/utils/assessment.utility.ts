/**
 * assessment.utility.ts
 *
 * Pure calculation helpers for the assessment engine.
 *
 * A stored score is the mark obtained for that assessment type, on a scale of
 * 0 up to the type's weight (the weight IS the maximum mark). The total is the
 * plain sum of the marks over the stages that have been conducted for a section
 * + term. Because a setup's weights sum to 100, once every stage is conducted
 * the total is out of 100. Stages that have not been conducted are excluded
 * entirely (neither numerator nor denominator).
 */

import { Types } from 'mongoose'

export interface AssessmentTotals {
  /** Sum of marks over conducted stages; null when none conducted. */
  total: number | null
  /** total / (sum of the conducted weights) * 100; null when none conducted. */
  average: number | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Computes the running total (plain sum of marks) and the average (percentage
 * of the conducted weight) for a set of stored scores.
 *
 * @param scores             Stored marksheet entries (assessmentTypeId + mark)
 * @param typeWeightById      Map of assessmentTypeId -> weight (also the max mark)
 * @param conductedStageIds   Set of assessmentTypeId that have been conducted
 */
export function computeTotals(
  scores: Array<{ assessmentTypeId: Types.ObjectId | string; score: number }>,
  typeWeightById: Map<string, number>,
  conductedStageIds: Set<string>
): AssessmentTotals {
  if (conductedStageIds.size === 0) {
    return { total: null, average: null }
  }

  // Average denominator: the total possible marks of the conducted stages.
  let conductedWeight = 0
  for (const typeId of conductedStageIds) {
    conductedWeight += typeWeightById.get(typeId) ?? 0
  }

  // Plain sum of the stored marks, counting only conducted stages.
  let total = 0
  for (const entry of scores) {
    const key = String(entry.assessmentTypeId)
    if (!conductedStageIds.has(key)) continue
    total += Number(entry.score)
  }

  const roundedTotal = round2(total)
  const average = conductedWeight > 0 ? round2((total / conductedWeight) * 100) : null
  return { total: roundedTotal, average }
}

/**
 * Derives the conducted-assessment status from progress. A record can only be
 * 'completed' when every stage in the setup has been conducted, so the old
 * "completed with missing stages" inconsistency is impossible.
 */
export function deriveStatus(
  conductedCount: number,
  totalTypes: number
): 'planned' | 'in-progress' | 'completed' {
  if (conductedCount <= 0) return 'planned'
  if (totalTypes > 0 && conductedCount >= totalTypes) return 'completed'
  return 'in-progress'
}

/**
 * Validates that a stage has been conducted. Throws a plain Error whose
 * message is safe to surface to clients (callers map it to a 4xx).
 */
export function validateConducted(
  conducted: { conductedStages: Array<Types.ObjectId | string> } | null,
  assessmentTypeId: Types.ObjectId | string,
  typeName?: string
): void {
  const isConducted =
    !!conducted &&
    conducted.conductedStages.some((id) => String(id) === String(assessmentTypeId))

  if (!isConducted) {
    throw new Error(
      typeName ? `Mark "${typeName}" conducted first!` : 'Mark this stage conducted first!'
    )
  }
}
