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
import { Student } from '../models/student.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { Subject } from '../models/subject.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import UserAccount from '../models/userAccount.model.js'
import { getCurrentAcademicSnapshot } from './currentAcademic.service.js'
import { loadSchoolDayContext } from './schoolDay.service.js'
import { addDaysSchoolDate, toSchoolDateString } from '../utils/schoolDate.util.js'
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

function gradeDisplayName(level: unknown): string {
  const raw = String(level ?? '').trim()
  if (!raw) return ''
  return /^grade\b/i.test(raw) ? raw : `Grade ${raw}`
}

function sectionLabel(gradeLevel: unknown, sectionName: unknown): string {
  const grade = gradeDisplayName(gradeLevel)
  const name = String(sectionName ?? '').trim()
  if (grade && name) return `${grade}${name}`
  return grade || name
}

function personName(person: any): string {
  return [person?.firstName, person?.middleName, person?.lastName]
    .filter(Boolean)
    .join(' ')
}

function startOfWeekMonday(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [year, month, day] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay()
  const offset = (weekday + 6) % 7
  return addDaysSchoolDate(date, -offset)
}

function collectSchoolDays(
  context: any,
  startDate: string | null,
  endDate: string | null,
  cutoffDate: string | null
): Set<string> {
  const days = new Set<string>()
  if (!startDate || !endDate || !cutoffDate) return days

  let cursor: string | null = startDate
  while (cursor && cursor <= endDate && cursor <= cutoffDate) {
    if (context.isSchoolDay(cursor).isSchoolDay) days.add(cursor)
    cursor = addDaysSchoolDate(cursor, 1)
  }
  return days
}

const CHRONIC_ABSENCE_MIN_DAYS = 3
const CHRONIC_ABSENCE_INCLUDES_EXCUSED = false
const CHRONIC_ABSENCE_STATUSES = CHRONIC_ABSENCE_INCLUDES_EXCUSED
  ? ['absent', 'excused']
  : ['absent']

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

export async function getAttendanceCompliance() {
  const loaded = await loadSchoolDayContext()
  if (!loaded.ok) {
    return {
      today: {
        date: null,
        applicable: false,
        reason: loaded.message,
        notTaken: [],
        partiallyTaken: [],
      },
      previousSchoolDay: null,
    }
  }

  const { context } = loaded
  const previousDate = context.previousSchoolDay(context.today)
  const todayOutcome = context.isSchoolDay(context.today)
  const previousOutcome = previousDate ? context.isSchoolDay(previousDate) : null
  const targetDates: string[] = []

  if (todayOutcome.isSchoolDay) targetDates.push(context.today)
  if (previousDate && previousOutcome?.isSchoolDay) targetDates.push(previousDate)

  const emptySlot = (date: string | null, applicable: boolean, reason: string | null) => ({
    date,
    applicable,
    reason,
    notTaken: [] as any[],
    partiallyTaken: [] as any[],
  })

  const todaySlot = emptySlot(
    context.today,
    todayOutcome.isSchoolDay,
    todayOutcome.isSchoolDay ? null : todayOutcome.reason
  )
  const previousSlot =
    previousDate === null
      ? null
      : emptySlot(
          previousDate,
          !!previousOutcome?.isSchoolDay,
          previousOutcome?.isSchoolDay ? null : previousOutcome?.reason ?? null
        )

  if (targetDates.length === 0) {
    return { today: todaySlot, previousSchoolDay: previousSlot }
  }

  const variants = getYearVariants(context.schoolYear)
  const sections = await Section.find({
    schoolYear: { $in: variants },
    isActive: true,
  })
    .select('name gradeId createdAt')
    .populate('gradeId', 'level')
    .lean()

  if (sections.length === 0) {
    return { today: todaySlot, previousSchoolDay: previousSlot }
  }

  const sectionIds = sections.map((section: any) => section._id)
  const [enrollments, attendanceRows, homeroomAssignments] = await Promise.all([
    StudentEnrollment.find({
      sectionId: { $in: sectionIds },
      schoolYear: { $in: variants },
      isActive: true,
    })
      .select('sectionId studentId')
      .lean(),
    Attendance.aggregate([
      { $match: { sectionId: { $in: sectionIds }, date: { $in: targetDates } } },
      {
        $group: {
          _id: { sectionId: '$sectionId', date: '$date' },
          studentIds: { $addToSet: '$studentId' },
          rowCount: { $sum: 1 },
        },
      },
    ]),
    TeachingAssignment.find({ sectionId: { $in: sectionIds }, role: 'homeroom' })
      .populate('teacherId', 'firstName middleName lastName')
      .lean(),
  ])

  const studentsBySection = new Map<string, Set<string>>()
  for (const enrollment of enrollments) {
    const sectionId = String(enrollment.sectionId)
    if (!studentsBySection.has(sectionId)) studentsBySection.set(sectionId, new Set())
    studentsBySection.get(sectionId)!.add(String(enrollment.studentId))
  }

  const homeroomBySection = new Map<string, any>()
  for (const assignment of homeroomAssignments) {
    homeroomBySection.set(String(assignment.sectionId), assignment.teacherId)
  }

  const attendanceByDateSection = new Map<
    string,
    { rowCount: number; studentIds: Set<string> }
  >()
  for (const row of attendanceRows) {
    const date = String(row._id?.date)
    const sectionId = String(row._id?.sectionId)
    attendanceByDateSection.set(`${date}|${sectionId}`, {
      rowCount: Number(row.rowCount) || 0,
      studentIds: new Set((row.studentIds ?? []).map((id: any) => String(id))),
    })
  }

  const buildEntry = (section: any) => {
    const sectionId = String(section._id)
    const teacher: any = homeroomBySection.get(sectionId)
    return {
      sectionId,
      sectionName: section.name,
      label: sectionLabel(section.gradeId?.level, section.name),
      grade: section.gradeId?.level ?? null,
      homeroomTeacher: teacher
        ? { id: String(teacher._id), name: personName(teacher) }
        : null,
    }
  }

  const buildForDate = (date: string) => {
    const notTaken: any[] = []
    const partiallyTaken: any[] = []

    for (const section of sections) {
      const sectionId = String(section._id)
      const createdDate = toSchoolDateString(section.createdAt, context.timeZone)
      if (createdDate && createdDate > date) continue

      const students = studentsBySection.get(sectionId)
      const total = students?.size ?? 0
      if (total === 0) continue

      const attendance = attendanceByDateSection.get(`${date}|${sectionId}`)
      if (!attendance || attendance.rowCount === 0) {
        notTaken.push(buildEntry(section))
        continue
      }

      let marked = 0
      for (const studentId of attendance.studentIds) {
        if (students!.has(studentId)) marked += 1
      }

      if (marked < total) {
        partiallyTaken.push({ ...buildEntry(section), marked, total })
      }
    }

    notTaken.sort((a, b) => a.label.localeCompare(b.label))
    partiallyTaken.sort((a, b) => a.label.localeCompare(b.label))
    return { notTaken, partiallyTaken }
  }

  if (todayOutcome.isSchoolDay) {
    const result = buildForDate(context.today)
    todaySlot.notTaken = result.notTaken
    todaySlot.partiallyTaken = result.partiallyTaken
  }

  if (previousDate && previousOutcome?.isSchoolDay && previousSlot) {
    const result = buildForDate(previousDate)
    previousSlot.notTaken = result.notTaken
    previousSlot.partiallyTaken = result.partiallyTaken
  }

  return { today: todaySlot, previousSchoolDay: previousSlot }
}

export async function getChronicAbsentees() {
  const emptyWeek = (reason: string | null) => ({
    minimumAbsentDays: CHRONIC_ABSENCE_MIN_DAYS,
    includesExcused: CHRONIC_ABSENCE_INCLUDES_EXCUSED,
    reason,
    currentWeek: {
      startDate: null as string | null,
      endDate: null as string | null,
      asOfDate: null as string | null,
      absentees: [] as any[],
    },
    previousWeek: {
      startDate: null as string | null,
      endDate: null as string | null,
      asOfDate: null as string | null,
      absentees: [] as any[],
    },
  })

  const loaded = await loadSchoolDayContext()
  if (!loaded.ok) return emptyWeek(loaded.message)

  const { context } = loaded
  const currentWeekStart = startOfWeekMonday(context.today)
  const previousWeekStart = currentWeekStart
    ? addDaysSchoolDate(currentWeekStart, -7)
    : null
  const currentWeekEnd = currentWeekStart
    ? addDaysSchoolDate(currentWeekStart, 6)
    : null
  const previousWeekEnd = currentWeekStart
    ? addDaysSchoolDate(currentWeekStart, -1)
    : null

  if (
    !currentWeekStart ||
    !previousWeekStart ||
    !currentWeekEnd ||
    !previousWeekEnd
  ) {
    return emptyWeek('Unable to resolve the current school week')
  }

  const currentSchoolDays = collectSchoolDays(
    context,
    currentWeekStart,
    currentWeekEnd,
    context.today
  )
  const previousSchoolDays = collectSchoolDays(
    context,
    previousWeekStart,
    previousWeekEnd,
    previousWeekEnd
  )

  const variants = getYearVariants(context.schoolYear)
  const attendanceRows = await Attendance.aggregate([
    {
      $match: {
        schoolYear: { $in: variants },
        date: { $gte: previousWeekStart, $lte: currentWeekEnd },
        status: { $in: CHRONIC_ABSENCE_STATUSES },
      },
    },
    { $group: { _id: { studentId: '$studentId', date: '$date' } } },
    {
      $group: {
        _id: '$_id.studentId',
        absenceDates: { $addToSet: '$_id.date' },
      },
    },
  ])

  const currentDatesByStudent = new Map<string, string[]>()
  const previousDatesByStudent = new Map<string, string[]>()

  for (const row of attendanceRows) {
    const studentId = String(row._id)
    const dates = (row.absenceDates ?? []).map((date: any) => String(date))
    const currentDates = dates
      .filter((date: string) => currentSchoolDays.has(date))
      .sort()
    const previousDates = dates
      .filter((date: string) => previousSchoolDays.has(date))
      .sort()

    if (currentDates.length >= CHRONIC_ABSENCE_MIN_DAYS) {
      currentDatesByStudent.set(studentId, currentDates)
    }
    if (previousDates.length >= CHRONIC_ABSENCE_MIN_DAYS) {
      previousDatesByStudent.set(studentId, previousDates)
    }
  }

  const qualifyingIds = Array.from(
    new Set([
      ...currentDatesByStudent.keys(),
      ...previousDatesByStudent.keys(),
    ])
  )

  if (qualifyingIds.length === 0) {
    return {
      ...emptyWeek(null),
      currentWeek: {
        startDate: currentWeekStart,
        endDate: currentWeekEnd,
        asOfDate: context.today,
        absentees: [],
      },
      previousWeek: {
        startDate: previousWeekStart,
        endDate: previousWeekEnd,
        asOfDate: previousWeekEnd,
        absentees: [],
      },
    }
  }

  const enrollments = await StudentEnrollment.find({
    studentId: { $in: qualifyingIds },
    schoolYear: { $in: variants },
    isActive: true,
  })
    .select('studentId sectionId createdAt')
    .sort({ createdAt: -1 })
    .lean()

  const enrollmentByStudent = new Map<string, any>()
  for (const enrollment of enrollments) {
    const studentId = String(enrollment.studentId)
    if (!enrollmentByStudent.has(studentId)) {
      enrollmentByStudent.set(studentId, enrollment)
    }
  }

  const studentIdsWithEnrollment = Array.from(enrollmentByStudent.keys())
  if (studentIdsWithEnrollment.length === 0) {
    return {
      ...emptyWeek(null),
      currentWeek: {
        startDate: currentWeekStart,
        endDate: currentWeekEnd,
        asOfDate: context.today,
        absentees: [],
      },
      previousWeek: {
        startDate: previousWeekStart,
        endDate: previousWeekEnd,
        asOfDate: previousWeekEnd,
        absentees: [],
      },
    }
  }

  const sectionIds = Array.from(
    new Set(
      Array.from(enrollmentByStudent.values())
        .map((enrollment: any) =>
          enrollment.sectionId ? String(enrollment.sectionId) : null
        )
        .filter((id): id is string => !!id)
    )
  )

  const [students, sections] = await Promise.all([
    Student.find({ _id: { $in: studentIdsWithEnrollment } })
      .select('firstName middleName lastName')
      .lean(),
    Section.find({ _id: { $in: sectionIds } })
      .select('name gradeId')
      .populate('gradeId', 'level')
      .lean(),
  ])

  const studentById = new Map(
    students.map((student: any) => [String(student._id), student])
  )
  const sectionById = new Map(
    sections.map((section: any) => [String(section._id), section])
  )

  const currentQualifiedIds = new Set(currentDatesByStudent.keys())
  const previousQualifiedIds = new Set(previousDatesByStudent.keys())

  const buildEntries = (datesByStudent: Map<string, string[]>) => {
    const entries: any[] = []
    for (const [studentId, dates] of datesByStudent) {
      const enrollment = enrollmentByStudent.get(studentId)
      if (!enrollment) continue
      const student = studentById.get(studentId) as any
      const section = enrollment.sectionId
        ? (sectionById.get(String(enrollment.sectionId)) as any)
        : null
      entries.push({
        studentId,
        studentName: personName(student) || 'Unknown student',
        sectionId: section ? String(section._id) : null,
        sectionLabel: section
          ? sectionLabel(section.gradeId?.level, section.name)
          : null,
        grade: section?.gradeId?.level ?? null,
        absenceDates: dates,
        absentDayCount: dates.length,
        appearsInBothWeeks:
          currentQualifiedIds.has(studentId) &&
          previousQualifiedIds.has(studentId),
      })
    }

    entries.sort(
      (a, b) =>
        b.absentDayCount - a.absentDayCount ||
        a.studentName.localeCompare(b.studentName)
    )
    return entries
  }

  return {
    minimumAbsentDays: CHRONIC_ABSENCE_MIN_DAYS,
    includesExcused: CHRONIC_ABSENCE_INCLUDES_EXCUSED,
    reason: null,
    currentWeek: {
      startDate: currentWeekStart,
      endDate: currentWeekEnd,
      asOfDate: context.today,
      absentees: buildEntries(currentDatesByStudent),
    },
    previousWeek: {
      startDate: previousWeekStart,
      endDate: previousWeekEnd,
      asOfDate: previousWeekEnd,
      absentees: buildEntries(previousDatesByStudent),
    },
  }
}

function classPerformanceBasePipeline(termId: any, sectionIds: any[]): any[] {
  return [
    { $match: { academicTermId: termId, sectionId: { $in: sectionIds } } },
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
        gsaId: 1,
        subjectId: '$gsa.subjectId',
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
        lockedTypeIds: 1,
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
        gsaId: 1,
        subjectId: 1,
        lockedStageCount: 1,
        lockedTypeIds: 1,
        subjectAverage: {
          $multiply: [{ $divide: ['$lockedScore', '$lockedWeight'] }, 100],
        },
      },
    },
  ]
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
    ...classPerformanceBasePipeline(term._id, sectionIds),
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

export async function getPerformanceAlerts(options: {
  threshold: number
  limit: number
}) {
  const { threshold, limit } = options
  const snapshot = await getCurrentAcademicSnapshot()
  const term = snapshot.currentTerm
  const calendar = snapshot.currentCalendar

  const emptyResult = (reason: string | null, schoolYear: string | null = null) => ({
    academicTermId: term ? String(term._id) : null,
    termName: term?.name ?? null,
    schoolYear,
    basis: 'locked-stages',
    threshold,
    limit,
    reason,
    sections: [] as any[],
    subjects: [] as any[],
  })

  if (!term) return emptyResult('no-current-term')

  const schoolYear = calendar ? normalizeYear(String(calendar.academicYear)) : null
  if (!schoolYear) return emptyResult('no-school-year')

  const sections = await Section.find({
    schoolYear: { $in: getYearVariants(schoolYear) },
    isActive: true,
  })
    .select('name gradeId')
    .populate('gradeId', 'level')
    .lean()

  if (sections.length === 0) return emptyResult(null, schoolYear)

  const sectionById = new Map(
    sections.map((section: any) => [String(section._id), section])
  )
  const sectionIds = sections.map((section: any) => section._id)

  const [facets] = await AssessmentScore.aggregate([
    ...classPerformanceBasePipeline(term._id, sectionIds),
    {
      $facet: {
        sections: [
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
            },
          },
          { $match: { average: { $lt: threshold } } },
          { $sort: { average: 1 } },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              sectionId: '$_id',
              average: { $round: ['$average', 1] },
              studentCount: 1,
            },
          },
        ],
        sectionStages: [
          { $project: { sectionId: 1, gsaId: 1, lockedTypeIds: 1 } },
          { $unwind: '$lockedTypeIds' },
          {
            $group: {
              _id: {
                sectionId: '$sectionId',
                gsaId: '$gsaId',
                typeId: '$lockedTypeIds',
              },
            },
          },
          {
            $group: {
              _id: '$_id.sectionId',
              lockedStageCount: { $sum: 1 },
            },
          },
        ],
        subjects: [
          {
            $group: {
              _id: {
                sectionId: '$sectionId',
                gsaId: '$gsaId',
                subjectId: '$subjectId',
              },
              average: { $avg: '$subjectAverage' },
              studentCount: { $sum: 1 },
              lockedStageCount: { $max: '$lockedStageCount' },
            },
          },
          { $match: { average: { $lt: threshold } } },
          {
            $lookup: {
              from: Subject.collection.name,
              localField: '_id.subjectId',
              foreignField: '_id',
              as: 'subject',
            },
          },
          { $unwind: { path: '$subject', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 0,
              sectionId: '$_id.sectionId',
              gsaId: '$_id.gsaId',
              subjectId: '$_id.subjectId',
              subjectName: { $ifNull: ['$subject.name', null] },
              average: { $round: ['$average', 1] },
              studentCount: 1,
              lockedStageCount: 1,
            },
          },
          { $sort: { average: 1 } },
          { $limit: limit },
        ],
      },
    },
  ])

  const lockedStagesBySection = new Map<string, number>()
  for (const row of facets?.sectionStages ?? []) {
    lockedStagesBySection.set(
      String(row._id),
      Number(row.lockedStageCount) || 0
    )
  }

  const sectionEntries = (facets?.sections ?? [])
    .map((row: any) => {
      const section = sectionById.get(String(row.sectionId)) as any
      if (!section) return null
      return {
        sectionId: String(row.sectionId),
        sectionName: section.name,
        label: sectionLabel(section.gradeId?.level, section.name),
        grade: section.gradeId?.level ?? null,
        average: row.average,
        studentCount: row.studentCount,
        lockedStageCount: lockedStagesBySection.get(String(row.sectionId)) ?? 0,
      }
    })
    .filter(Boolean)

  const subjectEntries = (facets?.subjects ?? [])
    .map((row: any) => {
      const section = sectionById.get(String(row.sectionId)) as any
      if (!section) return null
      return {
        sectionId: String(row.sectionId),
        sectionName: section.name,
        label: sectionLabel(section.gradeId?.level, section.name),
        grade: section.gradeId?.level ?? null,
        subjectId: row.subjectId ? String(row.subjectId) : null,
        subjectName: row.subjectName ?? null,
        average: row.average,
        studentCount: row.studentCount,
        lockedStageCount: row.lockedStageCount,
      }
    })
    .filter(Boolean)

  return {
    academicTermId: String(term._id),
    termName: term.name,
    schoolYear,
    basis: 'locked-stages',
    threshold,
    limit,
    reason: null,
    sections: sectionEntries,
    subjects: subjectEntries,
  }
}
