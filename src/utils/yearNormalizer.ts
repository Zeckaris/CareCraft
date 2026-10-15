/**
 * Year normalizer utility.
 *
 * School-year strings appear in two forms throughout the codebase:
 *   - Academic calendars:  "2024-2025"  (YYYY-YYYY)
 *   - Enrollments/sections: "2024-25"   (YYYY-YY)
 *
 * All comparisons must treat these as equivalent.
 *
 * normalizeYear("2024-25")    => "2024-2025"
 * normalizeYear("2024-2025")  => "2024-2025"
 * yearsMatch("2024-25", "2024-2025") => true
 */

export function normalizeYear(year: string): string {
  // Already in full form "YYYY-YYYY"
  if (/^\d{4}-\d{4}$/.test(year)) return year

  // Short form "YYYY-YY"
  const match = year.match(/^(\d{4})-(\d{2})$/)
  if (match) {
    const startYear = parseInt(match[1], 10)
    const shortEnd = parseInt(match[2], 10)
    // Construct end year: same century as start, or next if shortEnd < startYear's last two digits
    const startCentury = Math.floor(startYear / 100) * 100
    let endYear = startCentury + shortEnd
    if (endYear <= startYear) endYear += 100
    return `${startYear}-${endYear}`
  }

  // Return as-is if pattern is unrecognised
  return year
}

/**
 * Returns true if two school-year strings refer to the same academic year,
 * regardless of whether they use short ("2024-25") or long ("2024-2025") form.
 */
export function yearsMatch(a: string, b: string): boolean {
  return normalizeYear(a) === normalizeYear(b)
}

/**
 * Returns an array containing both forms of the school-year string
 * (e.g. ["2024-2025", "2024-25"]) for querying MongoDB documents
 * that might store either format.
 */
export function getYearVariants(year: string): string[] {
  if (!year) return []
  const norm = normalizeYear(year)
  const match = norm.match(/^(\d{4})-(\d{4})$/)
  if (match) {
    const shortForm = `${match[1]}-${match[2].slice(-2)}`
    return Array.from(new Set([norm, shortForm, year]))
  }
  return [year]
}
