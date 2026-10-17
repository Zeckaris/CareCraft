import { Request, Response } from 'express'
import { ScheduleSetting } from '../models/scheduleSetting.model.js'
import { WeeklyPeriodRequirement } from '../models/weeklyPeriodRequirement.model.js'
import { Grade } from '../models/grade.model.js'
import { Section } from '../models/section.model.js'
import { Subject } from '../models/subject.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import UserAccount from '../models/userAccount.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'
import { pickScheduleSettingData } from '../utils/scheduleSetting.util.js'
import {
  runSchedulePrecheck,
  type PrecheckInput,
} from '../utils/schedulePrecheck.util.js'

/**
 * GET /api/schedule/precheck?schoolYear=YYYY-YYYY
 * Roles: admin, coordinator
 *
 * Gathers the year's settings, grades, active sections, subjects, weekly
 * requirements and teaching assignments and runs the pure precheck module.
 * Returns { ok, errors, warnings, summary } — every problem at once.
 */
export const getSchedulePrecheck = async (req: Request, res: Response): Promise<void> => {
  const { schoolYear } = req.query
  if (!schoolYear || typeof schoolYear !== 'string') {
    sendResponse(res, 400, false, 'Missing required query parameter: schoolYear')
    return
  }

  try {
    const canonicalYear = normalizeYear(schoolYear)
    const variants = getYearVariants(canonicalYear)

    const [setting, grades, allSections, subjects, requirements, assignments, teachers] =
      await Promise.all([
        ScheduleSetting.findOne({ schoolYear: { $in: variants } }).lean(),
        Grade.find().lean(),
        Section.find({ schoolYear: { $in: variants } }).lean(),
        Subject.find().select('name').lean(),
        WeeklyPeriodRequirement.find({ schoolYear: { $in: variants } }).lean(),
        TeachingAssignment.find({ schoolYear: { $in: variants } }).lean(),
        UserAccount.find({ role: 'teacher', isSuspended: false })
          .select('firstName lastName')
          .lean(),
      ])

    const activeSections = allSections.filter((s) => s.isActive)
    const activeSectionIds = new Set(activeSections.map((s) => String(s._id)))

    // Only assignments to active sections participate; their gradeId is derived
    // from the section (teaching assignments don't store gradeId directly).
    const sectionGradeById = new Map<string, string>(
      allSections.map((s) => [String(s._id), String(s.gradeId)])
    )
    const scopedAssignments = assignments.filter((a) =>
      activeSectionIds.has(String(a.sectionId))
    )

    const input: PrecheckInput = {
      schoolYear: canonicalYear,
      settings: setting ? pickScheduleSettingData(setting) : null,
      grades: grades.map((g: any) => ({ _id: String(g._id), level: g.level })),
      sections: activeSections.map((s: any) => ({
        _id: String(s._id),
        gradeId: String(s.gradeId),
        name: s.name,
        isActive: true,
      })),
      subjects: subjects.map((s: any) => ({ _id: String(s._id), name: s.name })),
      requirements: requirements.map((r: any) => ({
        gradeId: String(r.gradeId),
        subjectId: String(r.subjectId),
        periodsPerWeek: r.periodsPerWeek,
        doublePeriod: r.doublePeriod,
      })),
      assignments: scopedAssignments.map((a: any) => ({
        _id: String(a._id),
        sectionId: String(a.sectionId),
        gradeId: sectionGradeById.get(String(a.sectionId)) ?? '',
        teacherId: String(a.teacherId),
        subjectId: a.subjectId ? String(a.subjectId) : null,
        role: a.role,
      })),
      teachers: teachers.map((t: any) => ({
        _id: String(t._id),
        name: `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim(),
      })),
    }

    const result = runSchedulePrecheck(input)

    sendResponse(
      res,
      200,
      true,
      result.ok ? 'Precheck passed with no errors' : 'Precheck found errors',
      result
    )
  } catch (error) {
    sendResponse(res, 500, false, 'Server error running schedule precheck', null, error)
  }
}
