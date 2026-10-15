import mongoose from 'mongoose'
import { connectDB } from '../config/database.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { Section } from '../models/section.model.js'
import { Grade } from '../models/grade.model.js'

/**
 * Migration Script: Migrate Add Sections
 *
 * Rules:
 * - Default: Dry run. Run with `--apply` to actually execute changes.
 * - Idempotent: Can be run multiple times safely.
 * - Non-destructive: Never deletes anything.
 * - Creates default section "A" for every (gradeId, schoolYear) pair found in StudentEnrollment
 *   (including inactive and historical enrollments).
 * - Sets sectionId on all enrollments that do not currently have a sectionId assigned.
 * - Reports detailed counts before and after.
 */

const runMigration = async () => {
  const isApply = process.argv.includes('--apply')
  const modeLabel = isApply ? 'APPLY MODE (Writing to database)' : 'DRY RUN (No changes will be saved)'

  console.log('========================================================')
  console.log(`CareCraft Migration: Add Default Section "A"`)
  console.log(`Mode: ${modeLabel}`)
  if (!isApply) {
    console.log(`Tip: To commit changes to the database, run:`)
    console.log(`     npm run migrate:sections -- --apply`)
  }
  console.log('========================================================\n')

  try {
    await connectDB()

    // 1. Find all distinct (gradeId, schoolYear) combinations in StudentEnrollment
    const pairs = await StudentEnrollment.aggregate([
      {
        $group: {
          _id: {
            gradeId: '$gradeId',
            schoolYear: '$schoolYear',
          },
          totalEnrollments: { $sum: 1 },
          unassignedEnrollments: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$sectionId', null] },
                    { $not: ['$sectionId'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ])

    console.log(`Found ${pairs.length} distinct (grade, schoolYear) enrollment group(s).\n`)

    let totalSectionsToCreate = 0
    let totalSectionsExisting = 0
    let totalEnrollmentsToUpdate = 0
    let totalEnrollmentsAlreadyAssigned = 0

    for (const group of pairs) {
      const { gradeId, schoolYear } = group._id
      const grade = await Grade.findById(gradeId).select('level')
      const gradeName = grade ? grade.level : gradeId.toString()

      // Check if Section "A" exists for this grade + year
      let section = await Section.findOne({
        gradeId,
        schoolYear,
        name: 'A',
      })

      if (!section) {
        totalSectionsToCreate++
        console.log(`[SECTION] Need to create: Grade "${gradeName}", Year "${schoolYear}", Section "A"`)
        if (isApply) {
          section = await Section.create({
            gradeId,
            schoolYear,
            name: 'A',
            isActive: true,
          })
          console.log(`          -> Created section _id: ${section._id}`)
        }
      } else {
        totalSectionsExisting++
        console.log(`[SECTION] Existing found: Grade "${gradeName}", Year "${schoolYear}", Section "A" (_id: ${section._id})`)
      }

      const unassigned = group.unassignedEnrollments
      const assigned = group.totalEnrollments - unassigned
      totalEnrollmentsAlreadyAssigned += assigned

      if (unassigned > 0) {
        totalEnrollmentsToUpdate += unassigned
        console.log(`[ENROLLMENTS] ${unassigned} enrollment(s) to assign to Section "A"`)

        if (isApply && section) {
          const updateResult = await StudentEnrollment.updateMany(
            {
              gradeId,
              schoolYear,
              $or: [{ sectionId: null }, { sectionId: { $exists: false } }],
            },
            {
              $set: { sectionId: section._id },
            }
          )
          console.log(`              -> Updated ${updateResult.modifiedCount} enrollment(s)`)
        }
      } else {
        console.log(`[ENROLLMENTS] All ${group.totalEnrollments} enrollment(s) already have a section assigned.`)
      }

      console.log('--------------------------------------------------------')
    }

    console.log('\n========================================================')
    console.log('MIGRATION SUMMARY:')
    console.log(`Mode:                               ${modeLabel}`)
    console.log(`Total enrollment groups:            ${pairs.length}`)
    console.log(`Sections to create / created:       ${totalSectionsToCreate}`)
    console.log(`Sections already existing:          ${totalSectionsExisting}`)
    console.log(`Enrollments needing assignment:     ${totalEnrollmentsToUpdate}`)
    console.log(`Enrollments already assigned:       ${totalEnrollmentsAlreadyAssigned}`)
    console.log('========================================================')

    if (!isApply && (totalSectionsToCreate > 0 || totalEnrollmentsToUpdate > 0)) {
      console.log('\nDry run completed successfully. No changes were written.')
      console.log('To apply these changes, re-run with: npm run migrate:sections -- --apply')
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
