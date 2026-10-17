import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { getYearVariants } from './yearNormalizer.js'

/**
 * Returns true when the given school year (in either "2024-25" or "2024-2025"
 * form) matches an existing academic calendar entry.
 */
export async function isValidSchoolYear(schoolYear: string): Promise<boolean> {
  const calendar = await AcademicCalendar.findOne({
    academicYear: { $in: getYearVariants(schoolYear) },
  })
  return !!calendar
}
