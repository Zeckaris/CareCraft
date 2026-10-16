import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { Section } from '../models/section.model.js'
import { Grade } from '../models/grade.model.js'
import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { getTeacherSectionIds } from '../middlewares/access.middleware.js'
import { getYearVariants, normalizeYear, yearsMatch } from '../utils/yearNormalizer.js'
import {
  planSectionSizes,
  distributeStudentsRandomly,
  buildSectionNames,
} from '../utils/sectionPlanning.util.js'

// ─── helpers ────────────────────────────────────────────────────────────────

/** Returns true when the schoolYear string is known to the academic calendar. */
const isValidSchoolYear = async (schoolYear: string): Promise<boolean> => {
  const cal = await AcademicCalendar.findOne({ academicYear: { $in: getYearVariants(schoolYear) } })
  return !!cal
}

/** True if any enrollment or teaching-assignment references this section. */
const isSectionReferenced = async (sectionId: any): Promise<boolean> => {
  const [envCount, taCount] = await Promise.all([
    StudentEnrollment.countDocuments({ sectionId }),
    TeachingAssignment.countDocuments({ sectionId }),
  ])
  return envCount > 0 || taCount > 0
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/** POST /api/section
 *  Roles: admin, coordinator
 */
export const createSection = async (req: Request, res: Response): Promise<void> => {
  const { gradeId, schoolYear, name, isActive } = req.body

  if (!gradeId || !schoolYear || !name) {
    sendResponse(res, 400, false, 'Missing required fields: gradeId, schoolYear, name')
    return
  }
  if (!mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid gradeId')
    return
  }

  try {
    const grade = await Grade.findById(gradeId)
    if (!grade) {
      sendResponse(res, 404, false, 'Grade not found')
      return
    }

    if (!(await isValidSchoolYear(schoolYear))) {
      sendResponse(res, 400, false, `schoolYear "${schoolYear}" does not match any academic calendar`)
      return
    }

    const canonicalYear = normalizeYear(schoolYear as string)
    const normName = (name as string).trim().toUpperCase()

    // Reject if the same section already exists under either year variant.
    const existing = await Section.findOne({
      gradeId,
      schoolYear: { $in: getYearVariants(canonicalYear) },
      name: normName,
    })
    if (existing) {
      sendResponse(res, 400, false, `Section "${normName}" already exists for this grade and year`)
      return
    }

    const section = await Section.create({
      gradeId,
      schoolYear: canonicalYear,
      name: normName,
      isActive: isActive !== undefined ? isActive : true,
    })

    const populated = await Section.findById(section._id).populate('gradeId', 'level description')
    sendResponse(res, 201, true, 'Section created successfully', populated)
  } catch (error) {
    sendResponse(res, 500, false, 'Server error creating section', null, error)
  }
}

/** GET /api/section
 *  Roles: admin, coordinator, teacher
 *  Query: gradeId, schoolYear, isActive
 */
export const getAllSections = async (req: Request, res: Response): Promise<void> => {
  const { gradeId, schoolYear, isActive, page = 1, limit = 50 } = req.query
  const skip = (Number(page) - 1) * Number(limit)
  const filter: any = {}

  if (gradeId) {
    if (!mongoose.isValidObjectId(gradeId)) {
      sendResponse(res, 400, false, 'Invalid gradeId')
      return
    }
    filter.gradeId = gradeId
  }
  if (schoolYear) filter.schoolYear = { $in: getYearVariants(schoolYear as string) }
  if (isActive !== undefined) filter.isActive = isActive === 'true'

  const user = (req as any).user
  if (user?.role === 'teacher') {
    const assignedIds = await getTeacherSectionIds(user.id)
    filter._id = { $in: assignedIds }
  }

  try {
    const total = await Section.countDocuments(filter)
    const sections = await Section.find(filter)
      .populate('gradeId', 'level description')
      .sort({ schoolYear: -1, name: 1 })
      .skip(skip)
      .limit(Number(limit))

    sendResponse(res, 200, true, 'Sections fetched successfully', sections, null, {
      total,
      page: Number(page),
      limit: Number(limit),
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching sections', null, error)
  }
}

/** GET /api/section/:id
 *  Roles: admin, coordinator, teacher
 */
export const getSectionById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid section ID')
    return
  }
  try {
    const user = (req as any).user
    if (user?.role === 'teacher') {
      const assignment = await TeachingAssignment.findOne({ teacherId: user.id, sectionId: id })
      if (!assignment) {
        sendResponse(res, 403, false, 'Forbidden: You are not assigned to this section')
        return
      }
    }

    const section = await Section.findById(id).populate('gradeId', 'level description')
    if (!section) {
      sendResponse(res, 404, false, 'Section not found')
      return
    }
    sendResponse(res, 200, true, 'Section fetched successfully', section)
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching section', null, error)
  }
}

/** PUT /api/section/:id
 *  Roles: admin, coordinator
 *  Only name and isActive are mutable once enrollments or assignments reference it.
 *  gradeId and schoolYear are immutable once the section is referenced.
 */
export const updateSection = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid section ID')
    return
  }

  try {
    const section = await Section.findById(id)
    if (!section) {
      sendResponse(res, 404, false, 'Section not found')
      return
    }

    const { gradeId, schoolYear, name, isActive } = req.body
    const referenced = await isSectionReferenced(section._id)

    if (referenced && (gradeId || schoolYear)) {
      sendResponse(
        res,
        400,
        false,
        'Cannot change gradeId or schoolYear once enrollments or assignments reference this section'
      )
      return
    }

    if (gradeId && gradeId !== section.gradeId.toString()) {
      if (!mongoose.isValidObjectId(gradeId)) {
        sendResponse(res, 400, false, 'Invalid gradeId')
        return
      }
      const grade = await Grade.findById(gradeId)
      if (!grade) {
        sendResponse(res, 404, false, 'Grade not found')
        return
      }
    }

    if (schoolYear && !yearsMatch(schoolYear, section.schoolYear)) {
      if (!(await isValidSchoolYear(schoolYear))) {
        sendResponse(res, 400, false, `schoolYear "${schoolYear}" does not match any academic calendar`)
        return
      }
    }

    const resolvedGradeId = gradeId || section.gradeId.toString()
    const resolvedSchoolYear = schoolYear
      ? normalizeYear(schoolYear as string)
      : section.schoolYear
    const resolvedName = name ? (name as string).trim().toUpperCase() : section.name

    // Check uniqueness if name/grade/year changed (across both year variants)
    if (
      resolvedName !== section.name ||
      resolvedGradeId !== section.gradeId.toString() ||
      !yearsMatch(resolvedSchoolYear, section.schoolYear)
    ) {
      const dup = await Section.findOne({
        gradeId: resolvedGradeId,
        schoolYear: { $in: getYearVariants(resolvedSchoolYear) },
        name: resolvedName,
        _id: { $ne: id },
      })
      if (dup) {
        sendResponse(
          res,
          400,
          false,
          `Section "${resolvedName}" already exists for that grade and year`
        )
        return
      }
    }

    section.name = resolvedName
    if (gradeId) section.gradeId = new mongoose.Types.ObjectId(gradeId)
    if (schoolYear) section.schoolYear = resolvedSchoolYear
    if (isActive !== undefined) section.isActive = isActive

    await section.save()
    const populated = await Section.findById(id).populate('gradeId', 'level description')
    sendResponse(res, 200, true, 'Section updated successfully', populated)
  } catch (error) {
    sendResponse(res, 500, false, 'Server error updating section', null, error)
  }
}

/** DELETE /api/section/:id
 *  Roles: admin
 *  Blocked if any enrollment or assignment references the section.
 */
export const deleteSection = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid section ID')
    return
  }
  try {
    const section = await Section.findById(id)
    if (!section) {
      sendResponse(res, 404, false, 'Section not found')
      return
    }

    if (await isSectionReferenced(section._id)) {
      sendResponse(
        res,
        400,
        false,
        'Cannot delete section: enrollments or teaching assignments reference it. Remove those first.'
      )
      return
    }

    await Section.findByIdAndDelete(id)
    sendResponse(res, 200, true, 'Section deleted successfully')
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting section', null, error)
  }
}

// ─── Roster ─────────────────────────────────────────────────────────────────

/** GET /api/section/:id/roster
 *  Returns active students in the section.
 *  Roles: admin, coordinator, teacher
 */
export const getSectionRoster = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) {
    sendResponse(res, 400, false, 'Invalid section ID')
    return
  }

  const { page = 1, limit = 50 } = req.query
  const skip = (Number(page) - 1) * Number(limit)

  try {
    const user = (req as any).user
    if (user?.role === 'teacher') {
      const assignment = await TeachingAssignment.findOne({ teacherId: user.id, sectionId: id })
      if (!assignment) {
        sendResponse(res, 403, false, 'Forbidden: You are not assigned to this section')
        return
      }
    }

    const section = await Section.findById(id).populate('gradeId', 'level description')
    if (!section) {
      sendResponse(res, 404, false, 'Section not found')
      return
    }

    const total = await StudentEnrollment.countDocuments({ sectionId: id, isActive: true })
    const enrollments = await StudentEnrollment.find({ sectionId: id, isActive: true })
      .populate('studentId', 'firstName middleName lastName gender profileImage')
      .populate('gradeId', 'level')
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 })

    sendResponse(
      res,
      200,
      true,
      'Section roster fetched successfully',
      { section, enrollments },
      null,
      { total, page: Number(page), limit: Number(limit) }
    )
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching section roster', null, error)
  }
}

// ─── My Sections (teacher self-service) ─────────────────────────────────────

/** GET /api/section/my
 *  Returns sections the logged-in teacher is assigned to for the active calendar year.
 *  Roles: teacher
 */
export const getMySections = async (req: Request, res: Response): Promise<void> => {
  const teacherId = (req as any).user?.id
  if (!teacherId) {
    sendResponse(res, 401, false, 'Unauthorized')
    return
  }

  try {
    // Use active calendar year; fall back to all years if none found.
    // Use getYearVariants so "2024-2025" matches sections stored as "2024-25".
    const activeCal = await AcademicCalendar.findOne({ isCurrent: true })
    const schoolYearFilter: any = {}
    if (activeCal) schoolYearFilter.schoolYear = { $in: getYearVariants(activeCal.academicYear) }

    const assignments = await TeachingAssignment.find({
      teacherId,
      ...schoolYearFilter,
    })
      .populate({
        path: 'sectionId',
        populate: { path: 'gradeId', select: 'level description' },
      })
      .populate('subjectId', 'name description')

    // Group by section
    const sectionMap = new Map<string, any>()
    for (const ta of assignments) {
      const sec = ta.sectionId as any
      const secId = sec._id.toString()
      if (!sectionMap.has(secId)) {
        sectionMap.set(secId, {
          section: sec,
          isHomeroom: false,
          subjects: [] as any[],
          studentCount: 0,
        })
      }
      const entry = sectionMap.get(secId)!
      if (ta.role === 'homeroom') {
        entry.isHomeroom = true
      } else if (ta.subjectId) {
        entry.subjects.push(ta.subjectId)
      }
    }

    // Attach student counts
    const sectionIds = Array.from(sectionMap.keys())
    const counts = await StudentEnrollment.aggregate([
      { $match: { sectionId: { $in: sectionIds.map((id) => new mongoose.Types.ObjectId(id)) }, isActive: true } },
      { $group: { _id: '$sectionId', count: { $sum: 1 } } },
    ])
    for (const c of counts) {
      const entry = sectionMap.get(c._id.toString())
      if (entry) entry.studentCount = c.count
    }

    sendResponse(res, 200, true, 'My sections fetched successfully', Array.from(sectionMap.values()))
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching my sections', null, error)
  }
}

// ─── Automatic section generation ───────────────────────────────────────────

const parsePositiveInt = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** POST /api/section/generate
 *  Roles: admin, coordinator
 *  Body: { gradeId, schoolYear, targetSize, minSize, maxSize, dryRun? }
 *
 *  Assigns the active, currently-unassigned enrollments of a grade + school
 *  year to alphabet-named sections. Existing empty sections for that grade +
 *  year are reused (in name order, keeping their teaching assignments) before
 *  new ones are created. Refuses when any existing section already has active
 *  students.
 *
 *  dryRun=true returns the planned sections/sizes without writing anything.
 *  The real run rolls back all changes if it fails midway.
 */
export const generateSections = async (req: Request, res: Response): Promise<void> => {
  const { gradeId, schoolYear, targetSize, minSize, maxSize, dryRun } = req.body ?? {}

  if (!gradeId || !schoolYear) {
    sendResponse(res, 400, false, 'Missing required fields: gradeId, schoolYear')
    return
  }
  if (!mongoose.isValidObjectId(gradeId)) {
    sendResponse(res, 400, false, 'Invalid gradeId')
    return
  }

  const target = parsePositiveInt(targetSize)
  const min = parsePositiveInt(minSize)
  const max = parsePositiveInt(maxSize)
  if (target === null || min === null || max === null) {
    sendResponse(res, 400, false, 'targetSize, minSize and maxSize must be positive integers')
    return
  }
  if (!(min <= target && target <= max)) {
    sendResponse(res, 400, false, 'Invalid sizes: must satisfy minSize <= targetSize <= maxSize')
    return
  }

  const isDryRun = dryRun === true || dryRun === 'true'

  try {
    const grade = await Grade.findById(gradeId)
    if (!grade) {
      sendResponse(res, 404, false, 'Grade not found')
      return
    }

    if (!(await isValidSchoolYear(schoolYear))) {
      sendResponse(res, 400, false, `schoolYear "${schoolYear}" does not match any academic calendar`)
      return
    }

    // "2024-25" and "2024-2025" refer to the same year.
    const variants = getYearVariants(schoolYear)
    const canonicalYear = normalizeYear(schoolYear as string)

    const existingSections = await Section.find({
      gradeId,
      schoolYear: { $in: variants },
    }).sort({ name: 1 })

    // Refuse if any existing section for this grade + year already has students.
    if (existingSections.length > 0) {
      const occupied = await StudentEnrollment.countDocuments({
        sectionId: { $in: existingSections.map((s) => s._id) },
        isActive: true,
      })
      if (occupied > 0) {
        sendResponse(
          res,
          409,
          false,
          `Cannot generate sections: ${occupied} active student(s) are already assigned to existing sections for this grade and school year. Move or clear them first.`
        )
        return
      }
    }

    // Active enrollments of this grade + year that have no section yet.
    const unassigned = await StudentEnrollment.find({
      gradeId,
      schoolYear: { $in: variants },
      isActive: true,
      $or: [{ sectionId: null }, { sectionId: { $exists: false } }],
    })
      .select('_id studentId')
      .lean()

    const { sizes, warning } = planSectionSizes(unassigned.length, target, min, max)

    // Reuse existing empty sections in name order; only create what is missing.
    const reusable = existingSections.slice(0, sizes.length)
    const takenNames = new Set(existingSections.map((s) => s.name.toUpperCase()))
    const newNames = buildSectionNames(
      Math.max(0, sizes.length - reusable.length),
      takenNames
    )

    const planSections: Array<{ section: any | null; name: string; size: number; isNew: boolean }> = []
    let newNameIndex = 0
    for (let i = 0; i < sizes.length; i++) {
      if (i < reusable.length) {
        planSections.push({
          section: reusable[i],
          name: reusable[i].name,
          size: sizes[i],
          isNew: false,
        })
      } else {
        planSections.push({
          section: null,
          name: newNames[newNameIndex++],
          size: sizes[i],
          isNew: true,
        })
      }
    }

    const buildPayload = (createdIds: string[] = []) => ({
      dryRun: isDryRun,
      gradeId: String(gradeId),
      schoolYear: canonicalYear,
      totalStudents: unassigned.length,
      targetSize: target,
      minSize: min,
      maxSize: max,
      sectionCount: planSections.length,
      sections: planSections.map((p) => ({
        sectionId: p.section ? String(p.section._id) : null,
        name: p.name,
        size: p.size,
        isNew: p.isNew,
      })),
      createdSectionIds: createdIds,
      warning: warning ?? null,
    })

    // Nothing to do (no students) or a dry run: never write.
    if (isDryRun || planSections.length === 0) {
      sendResponse(
        res,
        200,
        true,
        isDryRun ? 'Dry run: no changes were written' : 'No unassigned students to generate sections for',
        buildPayload()
      )
      return
    }

    // ── Commit (plan first, then write, with compensating rollback) ──────────
    const groups = distributeStudentsRandomly(unassigned as any[], sizes)
    const createdSections: any[] = []

    try {
      for (const ps of planSections) {
        if (ps.isNew) {
          const created = await Section.create({
            gradeId,
            schoolYear: canonicalYear,
            name: ps.name,
            isActive: true,
          })
          ps.section = created
          createdSections.push(created)
        }
      }

      const ops: any[] = []
      planSections.forEach((ps, i) => {
        for (const e of groups[i]) {
          ops.push({
            updateOne: {
              filter: {
                _id: e._id,
                $or: [{ sectionId: null }, { sectionId: { $exists: false } }],
              },
              update: { $set: { sectionId: ps.section._id } },
            },
          })
        }
      })
      if (ops.length > 0) await StudentEnrollment.bulkWrite(ops, { ordered: true })
    } catch (commitError) {
      const plannedEnrollmentIds = groups.flat().map((e: any) => e._id)
      const plannedSectionIds = planSections
        .map((p) => p.section?._id)
        .filter((id): id is any => Boolean(id))
      try {
        if (plannedEnrollmentIds.length > 0 && plannedSectionIds.length > 0) {
          await StudentEnrollment.updateMany(
            { _id: { $in: plannedEnrollmentIds }, sectionId: { $in: plannedSectionIds } },
            { $set: { sectionId: null } }
          )
        }
        for (const s of createdSections) await Section.findByIdAndDelete(s._id)
      } catch (rollbackError) {
        sendResponse(
          res,
          500,
          false,
          'Section generation failed and rollback was incomplete. Manual cleanup may be required.',
          null,
          rollbackError
        )
        return
      }
      sendResponse(res, 500, false, 'Section generation failed; all changes were rolled back', null, commitError)
      return
    }

    sendResponse(
      res,
      201,
      true,
      `Generated ${planSections.length} section(s) for ${unassigned.length} student(s)`,
      buildPayload(createdSections.map((s) => String(s._id)))
    )
  } catch (error) {
    sendResponse(res, 500, false, 'Server error generating sections', null, error)
  }
}
