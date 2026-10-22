import { ScheduleSetting } from '../models/scheduleSetting.model.js'
import { WeeklyPeriodRequirement } from '../models/weeklyPeriodRequirement.model.js'
import { Grade } from '../models/grade.model.js'
import { Section } from '../models/section.model.js'
import { Subject } from '../models/subject.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import UserAccount from '../models/userAccount.model.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'
import { pickScheduleSettingData, type ScheduleSettingData } from '../utils/scheduleSetting.util.js'
import { runSchedulePrecheck, type PrecheckInput, type PrecheckResult } from '../utils/schedulePrecheck.util.js'
import { buildLessons, buildValidationSettings } from '../utils/scheduleLessons.util.js'
import type { ValidationLesson, ValidationSettings } from '../utils/scheduleValidator.util.js'
import { computeScheduleFingerprint } from '../utils/scheduleFingerprint.util.js'

export interface CollectedScheduleData {
  schoolYear: string
  settingData: ScheduleSettingData | null
  settings: ValidationSettings | null
  lessons: ValidationLesson[]
  precheck: PrecheckResult
  fingerprint: string
}

/**
 * Gathers every plain document the school-wide generator needs for one year:
 * settings, active sections, requirements, teaching assignments and the
 * teachers used by the precheck. Runs the precheck so the caller can block on
 * errors before starting a solve.
 */
export async function collectScheduleData(schoolYearInput: string): Promise<CollectedScheduleData> {
  const schoolYear = normalizeYear(schoolYearInput)
  const variants = getYearVariants(schoolYear)

  const [setting, grades, allSections, subjects, requirements, assignments, teachers] =
    await Promise.all([
      ScheduleSetting.findOne({ schoolYear: { $in: variants } }).lean(),
      Grade.find().lean(),
      Section.find({ schoolYear: { $in: variants } }).lean(),
      Subject.find().select('name').lean(),
      WeeklyPeriodRequirement.find({ schoolYear: { $in: variants } }).lean(),
      TeachingAssignment.find({ schoolYear: { $in: variants } }).lean(),
      UserAccount.find({ role: 'teacher', isSuspended: false }).select('firstName lastName').lean(),
    ])

  const activeSections = allSections.filter((s: any) => s.isActive)
  const activeSectionIds = new Set(activeSections.map((s: any) => String(s._id)))
  const sectionGradeById = new Map<string, string>(
    allSections.map((s: any) => [String(s._id), String(s.gradeId)])
  )

  const scopedAssignments = assignments.filter((a: any) => activeSectionIds.has(String(a.sectionId)))

  const settingData = setting ? pickScheduleSettingData(setting) : null

  const precheckInput: PrecheckInput = {
    schoolYear,
    settings: settingData,
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

  const precheck = runSchedulePrecheck(precheckInput)

  const lessons = buildLessons({
    sections: activeSections.map((s: any) => ({ _id: String(s._id), gradeId: String(s.gradeId) })),
    requirements: requirements.map((r: any) => ({
      gradeId: String(r.gradeId),
      subjectId: String(r.subjectId),
      periodsPerWeek: r.periodsPerWeek,
      doublePeriod: r.doublePeriod,
    })),
    assignments: scopedAssignments.map((a: any) => ({
      _id: String(a._id),
      sectionId: String(a.sectionId),
      teacherId: String(a.teacherId),
      subjectId: a.subjectId ? String(a.subjectId) : null,
      role: a.role,
    })),
  })

  const settings = settingData && precheck.errors.length === 0 ? buildValidationSettings(settingData) : null

  const fingerprint = computeScheduleFingerprint({ settingData, lessons })

  return { schoolYear, settingData, settings, lessons, precheck, fingerprint }
}
