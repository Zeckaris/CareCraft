import mongoose from 'mongoose'
import { connectDB } from '../config/database.js'
import { ConductedAssessment } from '../models/ConductedAssessment.model.js'
import { GradeSubjectAssessment } from '../models/gradeSubjectAssessment.model.js'
import { AcademicTerm } from '../models/academicTerm.model.js'
import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { Section } from '../models/section.model.js'
import { Grade } from '../models/grade.model.js'
import { getYearVariants } from '../utils/yearNormalizer.js'

/**
 * Migration Script: Migrate Conducted Assessments Per Section
 *
 * Rules:
 * - Default: Dry run. Run with `--apply` to actually execute changes.
 * - Idempotent: Safe to run repeatedly.
 * - Non-destructive: Never deletes any records.
 * - For each unsectioned ConductedAssessment record:
 *   - Resolves the grade from the associated GradeSubjectAssessment (gsaId).
 *   - Resolves the school year from the associated AcademicTerm / AcademicCalendar.
 *   - Finds all sections for that grade and school year.
 *   - Assigns the existing record's sectionId to the first section.
 *   - Creates duplicate copies for any additional sections of that grade and year
 *     (preserving conductedStages and status) so results stay identical across all sections.
 */

const runMigration = async () => {
  const isApply = process.argv.includes('--apply')
  const modeLabel = isApply ? 'APPLY MODE (Writing to database)' : 'DRY RUN (No changes will be saved)'

  console.log('========================================================')
  console.log('CareCraft Migration: Assign Conducted Assessments to Sections')
  console.log(`Mode: ${modeLabel}`)
  if (!isApply) {
    console.log('Tip: To commit changes to the database, run:')
    console.log('     npm run migrate:conducted -- --apply')
  }
  console.log('========================================================\n')

  try {
    await connectDB()

    // 1. Find all conducted assessment records without a sectionId
    const unsectioned = await ConductedAssessment.find({
      $or: [{ sectionId: null }, { sectionId: { $exists: false } }],
    })

    console.log(`Found ${unsectioned.length} unsectioned ConductedAssessment record(s).\n`)

    let totalUpdated = 0
    let totalCloned = 0
    let skipped = 0

    for (const record of unsectioned) {
      const gsa = await GradeSubjectAssessment.findById(record.gsaId)
      if (!gsa) {
        console.warn(`[WARN] GSA ${record.gsaId} not found for ConductedAssessment ${record._id}. Skipping.`)
        skipped++
        continue
      }

      const term = await AcademicTerm.findById(record.academicTermId)
      let schoolYear: string | undefined
      if (term && term.calendarId) {
        const cal = await AcademicCalendar.findById(term.calendarId)
        if (cal) schoolYear = cal.academicYear
      }

      // If no calendar found, fall back to current calendar
      if (!schoolYear) {
        const activeCal = await AcademicCalendar.findOne({ isCurrent: true })
        if (activeCal) schoolYear = activeCal.academicYear
      }

      const grade = await Grade.findById(gsa.gradeId)
      const gradeLabel = grade ? grade.level : gsa.gradeId.toString()

      // Find all sections for this grade + year
      let sections: any[] = []
      if (schoolYear) {
        sections = await Section.find({
          gradeId: gsa.gradeId,
          schoolYear: { $in: getYearVariants(schoolYear) },
        })
      }

      // Fallback: if no sections matched year, find any sections for this grade
      if (sections.length === 0) {
        sections = await Section.find({ gradeId: gsa.gradeId })
      }

      // If still no sections exist, create default Section "A"
      if (sections.length === 0) {
        const fallbackYear = schoolYear || '2024-2025'
        console.log(`[SECTION] No section exists for Grade "${gradeLabel}". Need Section "A" (${fallbackYear}).`)
        if (isApply) {
          const newSec = await Section.create({
            gradeId: gsa.gradeId,
            schoolYear: fallbackYear,
            name: 'A',
            isActive: true,
          })
          sections = [newSec]
          console.log(`          -> Created section _id: ${newSec._id}`)
        } else {
          sections = [{ _id: new mongoose.Types.ObjectId(), name: 'A (pending creation)' }]
        }
      }

      console.log(
        `[RECORD] ConductedAssessment ${record._id} (Grade: ${gradeLabel}, Stages: ${record.conductedStages.length})`
      )
      console.log(`         -> Matching sections found: ${sections.map((s) => s.name).join(', ')}`)

      // First section gets the existing record updated
      const firstSection = sections[0]
      console.log(`         -> Assigning existing record to Section "${firstSection.name}" (_id: ${firstSection._id})`)
      totalUpdated++

      if (isApply) {
        await ConductedAssessment.findByIdAndUpdate(record._id, {
          $set: { sectionId: firstSection._id },
        })
      }

      // For any additional sections, create a copy if one doesn't exist yet
      for (let i = 1; i < sections.length; i++) {
        const sec = sections[i]
        const exists = await ConductedAssessment.findOne({
          gsaId: record.gsaId,
          academicTermId: record.academicTermId,
          sectionId: sec._id,
        })

        if (!exists) {
          console.log(`         -> Creating clone for Section "${sec.name}" (_id: ${sec._id})`)
          totalCloned++
          if (isApply) {
            await ConductedAssessment.create({
              gsaId: record.gsaId,
              academicTermId: record.academicTermId,
              sectionId: sec._id,
              conductedStages: record.conductedStages,
              status: record.status,
            })
          }
        } else {
          console.log(`         -> Section "${sec.name}" already has a ConductedAssessment record.`)
        }
      }

      console.log('--------------------------------------------------------')
    }

    console.log('\n========================================================')
    console.log('MIGRATION SUMMARY:')
    console.log(`Mode:                                ${modeLabel}`)
    console.log(`Unsectioned records found:           ${unsectioned.length}`)
    console.log(`Records updated with sectionId:      ${totalUpdated}`)
    console.log(`New section clone records created:   ${totalCloned}`)
    console.log(`Records skipped (missing GSA/term):  ${skipped}`)
    console.log('========================================================')

    if (!isApply && (totalUpdated > 0 || totalCloned > 0)) {
      console.log('\nDry run completed successfully. No changes were written.')
      console.log('To apply these changes, run: npm run migrate:conducted -- --apply')
    } else {
      console.log('\nMigration execution completed successfully.')
    }
  } catch (error) {
    console.error('Migration failed with error:', error)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
    console.log('Database disconnected.')
  }
}

runMigration()
