/**
 * Shared attendance-rate calculation.
 *
 * School rule: an excused absence must never count against a student. Excused
 * records are therefore removed from the denominator, while late arrivals still
 * count as attended.
 */

export interface AttendanceRateCounts {
  present: number
  late: number
  excused: number
  total: number
}

export function calculateAttendanceRate(
  counts: AttendanceRateCounts
): number | null {
  const denominator = counts.total - counts.excused
  if (denominator <= 0) return null
  return ((counts.present + counts.late) / denominator) * 100
}
