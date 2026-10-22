/**
 * Shared attendance-rate calculation.
 *
 * Non-badge surfaces (dashboard, summaries, reports) keep the school rule that
 * an excused absence must never count against a student: excused records are
 * removed from the denominator, while late arrivals still count as attended.
 *
 * Badge evaluation passes `countExcusedAsAbsent` so an excused absence counts
 * as an absence only for badge criteria.
 */

export interface AttendanceRateCounts {
  present: number
  late: number
  excused: number
  total: number
}

export function calculateAttendanceRate(
  counts: AttendanceRateCounts,
  countExcusedAsAbsent = false
): number | null {
  const denominator = countExcusedAsAbsent
    ? counts.total
    : counts.total - counts.excused
  if (denominator <= 0) return null
  return ((counts.present + counts.late) / denominator) * 100
}
