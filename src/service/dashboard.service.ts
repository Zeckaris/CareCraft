import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { AssessmentSetup } from '../models/assessment/assessmentSetup.model.js'
import { AssessmentType } from '../models/assessment/assessmentType.model.js'
import { AssessmentScore } from '../models/assessment/assessmentScore.model.js'
import { Attendance } from '../models/attendance.model.js'
import { AuditLog } from '../models/auditLog.model.js'
import { ConductedAssessment } from '../models/ConductedAssessment.model.js'
import { Grade } from '../models/grade.model.js'
import { GradeSubjectAssessment } from '../models/gradeSubjectAssessment.model.js'
import { Section } from '../models/section.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import UserAccount from '../models/userAccount.model.js'
import { getCurrentAcademicSnapshot } from './currentAcademic.service.js'
import { loadSchoolDayContext } from './schoolDay.service.js'
import { getYearVariants, normalizeYear } from '../utils/yearNormalizer.js'

const HEX_ID_RE = /[0-9a-fA-F]{24}/

type GradeRow = {
  grade: string
  gradeLevel: number | null
  counts: number[]
}

function gradeNumericLevel(level: unknown): number | null {
  const raw = String(level ?? '').trim()
  if (!raw) return null
  const value = parseInt(raw.replace(/^Grade\s+/i, ''), 10)
  return Number.isFinite(value) ? value : null
}

function compareGrades(a: GradeRow, b: GradeRow): number {
  const aLevel = a.gradeLevel
  const bLevel = b.gradeLevel
  if (aLevel === null && bLevel === null) return a.grade.localeCompare(b.grade)
  if (aLevel === null) return 1
  if (bLevel === null) return -1
  if (aLevel !== bLevel) return aLevel - bLevel
  return a.grade.localeCompare(b.grade)
}

export async function getEnrollmentTrend(): Promise<{
  years: string[]
  grades: GradeRow[]
}> {
  const calendars = await AcademicCalendar.find()
    .sort({ startDate: -1 })
    .select('academicYear startDate')
    .lean()

  const latest = calendars.slice(0, 3).reverse()
  if (latest.length === 0) return { years: [], grades: [] }

  const years = latest.map((calendar: any) => normalizeYear(String(calendar.academicYear)))
  const variants = Array.from(new Set(years.flatMap((year) => getYearVariants(year))))
  const yearBranches = latest.map((calendar: any) => ({
    case: {
      $in: ['$schoolYear', getYearVariants(String(calendar.academicYear))],
    },
    then: normalizeYear(String(calendar.academicYear)),
  }))

  const rows = await StudentEnrollment.aggregate([
    { $match: { schoolYear: { $in: variants } } },
    {
      $addFields: {
        normalizedYear: {
          $switch: {
            branches: yearBranches,
            default: '$schoolYear',
          },
        },
      },
    },
    {
      $group: {
        _id: {
          gradeId: '$gradeId',
          year: '$normalizedYear',
          studentId: '$studentId',
        },
      },
    },
    {
      $group: {
        _id: {
          gradeId: '$_id.gradeId',
          year: '$_id.year',
        },
        count: { $sum: 1 },
      },
    },
  ])

  const gradeIds = Array.from(new Set(rows.map((row: any) => String(row._id.gradeId))))
  const gradeDocs = await Grade.find({ _id: { $in: gradeIds } })
    .select('level')
    .lean()
  const gradeById = new Map(gradeDocs.map((grade: any) => [String(grade._id), grade]))

  const countsByGrade = new Map<string, number[]>()
  for (const row of rows) {
    const gradeId = String(row._id.gradeId)
    const yearIndex = years.indexOf(String(row._id.year))
    if (yearIndex === -1) continue
    if (!countsByGrade.has(gradeId)) {
      countsByGrade.set(gradeId, years.map(() => 0))
    }
    countsByGrade.get(gradeId)![yearIndex] += Number(row.count) || 0
  }

  const grades: GradeRow[] = []
  for (const [gradeId, counts] of countsByGrade) {
    const grade = gradeById.get(gradeId) as any
    if (!grade) continue
    grades.push({
      grade: grade.level,
      gradeLevel: gradeNumericLevel(grade.level),
      counts,
    })
  }

  grades.sort(compareGrades)
  return { years, grades }
}

export async function getRecentActivities(limit: number) {
  const accounts = await UserAccount.find({ role: { $in: ['admin', 'coordinator'] } })
    .select('firstName lastName role')
    .lean()
  if (accounts.length === 0) return []

  const accountById = new Map(accounts.map((account: any) => [String(account._id), account]))
  const activities = await AuditLog.find({
    actor: { $in: accounts.map((account: any) => account._id) },
    message: { $not: HEX_ID_RE },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()

  return activities.map((activity: any) => {
    const account = accountById.get(String(activity.actor)) as any
    const actorName = [account?.firstName, account?.lastName].filter(Boolean).join(' ')
    return {
      id: String(activity._id),
      type: activity.type,
      message: activity.message,
      actorName,
      actorRole: activity.actorRole ?? account?.role ?? null,
      createdAt: activity.createdAt,
    }
  })
}

const emptyAttendanceSnapshot = (schoolYear: string | null) => ({
  date: null,
  schoolYear,
  present: 0,
  absent: 0,
  late: 0,
  excused: 0,
  marked: 0,
  expected: 0,
  sectionsWithRecords: 0,
  totalSections: 0,
})

export async function getAttendanceSnapshot() {
  const loaded = await loadSchoolDayContext()
  if (!loaded.ok) return emptyAttendanceSnapshot(null)

  const { context } = loaded
  const date = context.previousSchoolDay(context.today)
  if (!date) return emptyAttendanceSnapshot(context.schoolYear)

  const variants = getYearVariants(context.schoolYear)
  const [attendanceRows, expected, totalSections] = await Promise.all([
    Attendance.aggregate([
      { $match: { schoolYear: { $in: variants }, date } },
      {
        $group: {
          _id: null,
          present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
          marked: { $sum: 1 },
          sections: { $addToSet: '$sectionId' },
        },
      },
      {
        $project: {
          _id: 0,
          present: 1,
          absent: 1,
          late: 1,
          excused: 1,
          marked: 1,
          sectionsWithRecords: { $size: '$sections' },
        },
      },
    ]),
    StudentEnrollment.countDocuments({ schoolYear: { $in: variants }, isActive: true }),
    Section.countDocuments({ schoolYear: { $in: variants }, isActive: true }),
  ])

  const row = attendanceRows[0] ?? {}
  return {
    date,
    schoolYear: context.schoolYear,
    present: Number(row.present) || 0,
    absent: Number(row.absent) || 0,
    late: Number(row.late) || 0,
    excused: Number(row.excused) || 0,
    marked: Number(row.marked) || 0,
    expected,
    sectionsWithRecords: Number(row.sectionsWithRecords) || 0,
    totalSections,
  }
}

export async function getClassPerformance() {
  const snapshot = await getCurrentAcademicSnapshot()
  const term = snapshot.currentTerm
  const calendar = snapshot.currentCalendar

  if (!term) {
    return {
      academicTermId: null,
      termName: null,
      schoolYear: null,
      basis: 'locked-stages',
      threshold: 80,
      topClasses: [],
    }
  }

  const schoolYear = calendar ? normalizeYear(String(calendar.academicYear)) : null
  if (!schoolYear) {
    return {
      academicTermId: String(term._id),
      termName: term.name,
      schoolYear: null,
      basis: 'locked-stages',
      threshold: 80,
      topClasses: [],
    }
  }

  const sections = await Section.find({ schoolYear: { $in: getYearVariants(schoolYear) } })
    .select('name gradeId')
    .populate('gradeId', 'level')
    .lean()
  if (sections.length === 0) {
    return {
      academicTermId: String(term._id),
      termName: term.name,
      schoolYear,
      basis: 'locked-stages',
      threshold: 80,
      topClasses: [],
    }
  }

  const sectionById = new Map(sections.map((section: any) => [String(section._id), section]))
  const sectionIds = sections.map((section: any) => section._id)

  const rows = await AssessmentScore.aggregate([
    { $match: { academicTermId: term._id, sectionId: { $in: sectionIds } } },
    {
      $lookup: {
        from: ConductedAssessment.collection.name,
        let: { gsaId: '$gsaId', sectionId: '$sectionId', termId: '$academicTermId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$gsaId', '$$gsaId'] },
                  { $eq: ['$sectionId', '$$sectionId'] },
                  { $eq: ['$academicTermId', '$$termId'] },
                ],
              },
            },
          },
        ],
        as: 'conducted',
      },
    },
    { $unwind: '$conducted' },
    {
      $lookup: {
        from: GradeSubjectAssessment.collection.name,
        localField: 'gsaId',
        foreignField: '_id',
        as: 'gsa',
      },
    },
    { $unwind: '$gsa' },
    {
      $lookup: {
        from: AssessmentSetup.collection.name,
        localField: 'gsa.assessmentSetupId',
        foreignField: '_id',
        as: 'setup',
      },
    },
    { $unwind: '$setup' },
    {
      $lookup: {
        from: AssessmentType.collection.name,
        localField: 'setup.assessmentTypeIds',
        foreignField: '_id',
        as: 'setupTypes',
      },
    },
    {
      $addFields: {
        lockedTypes: {
          $filter: {
            input: '$setupTypes',
            as: 'type',
            cond: {
              $in: ['$$type._id', { $ifNull: ['$conducted.lockedStages', []] }],
            },
          },
        },
      },
    },
    {
      $addFields: {
        lockedTypeIds: {
          $map: {
            input: '$lockedTypes',
            as: 'type',
            in: '$$type._id',
          },
        },
      },
    },
    {
      $project: {
        sectionId: 1,
        studentId: 1,
        lockedStageCount: { $size: '$lockedTypes' },
        lockedWeight: {
          $sum: {
            $map: {
              input: '$lockedTypes',
              as: 'type',
              in: { $ifNull: ['$$type.weight', 0] },
            },
          },
        },
        lockedScore: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: '$scores',
                  as: 'score',
                  cond: { $in: ['$$score.assessmentTypeId', '$lockedTypeIds'] },
                },
              },
              as: 'score',
              in: { $ifNull: ['$$score.score', 0] },
            },
          },
        },
      },
    },
    {
      $match: {
        lockedStageCount: { $gt: 0 },
        lockedWeight: { $gt: 0 },
      },
    },
    {
      $project: {
        sectionId: 1,
        studentId: 1,
        subjectAverage: {
          $multiply: [{ $divide: ['$lockedScore', '$lockedWeight'] }, 100],
        },
      },
    },
    {
      $group: {
        _id: { sectionId: '$sectionId', studentId: '$studentId' },
        studentAverage: { $avg: '$subjectAverage' },
      },
    },
    {
      $group: {
        _id: '$_id.sectionId',
        average: { $avg: '$studentAverage' },
        studentCount: { $sum: 1 },
        countAbove80: {
          $sum: { $cond: [{ $gt: ['$studentAverage', 80] }, 1, 0] },
        },
      },
    },
    { $sort: { average: -1, countAbove80: -1 } },
    { $limit: 3 },
    {
      $project: {
        _id: 0,
        sectionId: '$_id',
        average: { $round: ['$average', 1] },
        studentCount: 1,
        countAbove80: 1,
      },
    },
  ])

  const topClasses = rows
    .map((row: any) => {
      const section = sectionById.get(String(row.sectionId)) as any
      if (!section) return null
      return {
        sectionId: String(row.sectionId),
        sectionName: section.name,
        gradeLevel: section.gradeId?.level ?? null,
        average: row.average,
        studentCount: row.studentCount,
        countAbove80: row.countAbove80,
      }
    })
    .filter(Boolean)

  return {
    academicTermId: String(term._id),
    termName: term.name,
    schoolYear,
    basis: 'locked-stages',
    threshold: 80,
    topClasses,
  }
}
