import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import { connectDB } from '../config/database.js'
import UserAccount from '../models/userAccount.model.js'
import { Student } from '../models/student.model.js'
import { Grade } from '../models/grade.model.js'
import { AcademicCalendar } from '../models/academicCalendar.model.js'
import { Section } from '../models/section.model.js'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import { StudentEnrollment } from '../models/studentEnrollment.model.js'
import { GradeSubjectAssessment } from '../models/gradeSubjectAssessment.model.js'

const PASSWORD = 'password123'

const PARENTS = [
  { firstName: 'Tigist', lastName: 'Alemu', email: 'tigist.alemu@parent.carecraft.demo', role: 'parent' as const, phoneNumber: '+97310000001' },
  { firstName: 'Sarah', lastName: 'Benjamin', email: 'sarah.benjamin@parent.carecraft.demo', role: 'parent' as const, phoneNumber: '+97310000002' },
  { firstName: 'Robert', lastName: 'Calloway', email: 'robert.calloway@parent.carecraft.demo', role: 'parent' as const, phoneNumber: '+97310000003' },
  { firstName: 'Maria', lastName: 'Saren', email: 'maria.saren@parent.carecraft.demo', role: 'parent' as const, phoneNumber: '+97310000004' },
  { firstName: 'Thomas', lastName: 'Thalwyn', email: 'thomas.thalwyn@parent.carecraft.demo', role: 'parent' as const, phoneNumber: '+97310000005' },
]

const TEACHERS = [
  { firstName: 'Helen', lastName: 'Smith', email: 'helen.smith@carecraft.demo', role: 'teacher' as const, phoneNumber: '+97320000001' },
  { firstName: 'David', lastName: 'Johnson', email: 'david.johnson@carecraft.demo', role: 'teacher' as const, phoneNumber: '+97320000002' },
  { firstName: 'Sara', lastName: 'Mohammed', email: 'sara.mohammed@carecraft.demo', role: 'teacher' as const, phoneNumber: '+97320000003' },
  { firstName: 'Michael', lastName: 'Chen', email: 'michael.chen@carecraft.demo', role: 'teacher' as const, phoneNumber: '+97320000004' },
  { firstName: 'Abeba', lastName: 'Bekele', email: 'abeba.bekele@carecraft.demo', role: 'teacher' as const, phoneNumber: '+97320000005' },
  { firstName: 'Yonas', lastName: 'Tadesse', email: 'yonas.tadesse@carecraft.demo', role: 'teacher' as const, phoneNumber: '+97320000006' },
  { firstName: 'Martha', lastName: 'Wondimu', email: 'martha.wondimu@carecraft.demo', role: 'teacher' as const, phoneNumber: '+97320000007' },
]

const COORDINATORS = [
  { firstName: 'Amanuel', lastName: 'Fisseha', email: 'amanuel.fisseha@carecraft.demo', role: 'coordinator' as const, phoneNumber: '+97330000001' },
  { firstName: 'Hana', lastName: 'Gebre', email: 'hana.gebre@carecraft.demo', role: 'coordinator' as const, phoneNumber: '+97330000002' },
]

const seedDemoData = async () => {
  try {
    await connectDB()
    const hashedPassword = await bcrypt.hash(PASSWORD, 10)

    // --- Create Parents ---
    console.log('--- Creating Parents ---')
    const students = await Student.find().lean()
    if (students.length === 0) {
      console.log('No students found. Skipping parent links.')
    } else {
      console.log(`Found ${students.length} students to link parents to.`)
    }

    for (let i = 0; i < PARENTS.length; i++) {
      const p = PARENTS[i]
      const existing = await UserAccount.findOne({ email: p.email })
      let parent = existing
      if (existing) {
        console.log(`Parent already exists: ${p.email}`)
      } else {
        parent = await UserAccount.create({ ...p, password: hashedPassword })
        console.log(`Created parent: ${p.firstName} ${p.lastName} (${p.email})`)
      }

      if (parent && i < students.length) {
        await Student.findByIdAndUpdate(students[i]._id, { parentId: parent._id })
        console.log(`  -> Linked to student: ${students[i].firstName} ${students[i].lastName}`)
      }
    }

    // --- Create Teachers ---
    console.log('\n--- Creating Teachers ---')
    const createdTeachers: any[] = []
    for (const t of TEACHERS) {
      const existing = await UserAccount.findOne({ email: t.email })
      if (existing) {
        console.log(`Teacher already exists: ${t.email}`)
        createdTeachers.push(existing)
        continue
      }
      const teacher = await UserAccount.create({ ...t, password: hashedPassword })
      console.log(`Created teacher: ${t.firstName} ${t.lastName} (${t.email})`)
      createdTeachers.push(teacher)
    }

    // --- Create Coordinators ---
    console.log('\n--- Creating Coordinators ---')
    for (const c of COORDINATORS) {
      const existing = await UserAccount.findOne({ email: c.email })
      if (existing) {
        console.log(`Coordinator already exists: ${c.email}`)
        continue
      }
      await UserAccount.create({ ...c, password: hashedPassword })
      console.log(`Created coordinator: ${c.firstName} ${c.lastName} (${c.email})`)
    }

    // --- Create Demo Sections & Teaching Assignments ---
    console.log('\n--- Creating Demo Sections & Teaching Assignments ---')
    const activeCalendar = await AcademicCalendar.findOne({ isCurrent: true })
    const schoolYear = activeCalendar ? activeCalendar.academicYear : '2024-2025'
    const grades = await Grade.find()

    console.log(`Active School Year: ${schoolYear}`)
    console.log(`Found ${grades.length} grade(s)`)

    let teacherIndex = 0
    for (const grade of grades) {
      for (const sectionName of ['A', 'B']) {
        let section = await Section.findOne({
          gradeId: grade._id,
          schoolYear,
          name: sectionName,
        })

        if (!section) {
          section = await Section.create({
            gradeId: grade._id,
            schoolYear,
            name: sectionName,
            isActive: true,
          })
          console.log(`Created section: ${grade.level}-${sectionName} (${schoolYear})`)
        } else {
          console.log(`Section already exists: ${grade.level}-${sectionName} (${schoolYear})`)
        }

        // Link homeroom teacher if not assigned
        const existingHomeroom = await TeachingAssignment.findOne({
          sectionId: section._id,
          role: 'homeroom',
        })
        if (!existingHomeroom && createdTeachers.length > 0) {
          const teacher = createdTeachers[teacherIndex % createdTeachers.length]
          await TeachingAssignment.create({
            sectionId: section._id,
            teacherId: teacher._id,
            role: 'homeroom',
            schoolYear,
          })
          console.log(`  -> Assigned homeroom teacher: ${teacher.firstName} ${teacher.lastName}`)
          teacherIndex++
        }

        // Link subject teachers if GSAs exist for this grade
        const gsas = await GradeSubjectAssessment.find({ gradeId: grade._id })
        for (const gsa of gsas) {
          const existingSubjectTa = await TeachingAssignment.findOne({
            sectionId: section._id,
            role: 'subject',
            subjectId: gsa.subjectId,
          })
          if (!existingSubjectTa && createdTeachers.length > 0) {
            const teacher = createdTeachers[teacherIndex % createdTeachers.length]
            await TeachingAssignment.create({
              sectionId: section._id,
              teacherId: teacher._id,
              role: 'subject',
              subjectId: gsa.subjectId,
              schoolYear,
            })
            console.log(`  -> Assigned subject teacher for subject ${gsa.subjectId}: ${teacher.firstName} ${teacher.lastName}`)
            teacherIndex++
          }
        }

        // Link unassigned enrollments for this grade + year to Section "A"
        if (sectionName === 'A') {
          const updated = await StudentEnrollment.updateMany(
            {
              gradeId: grade._id,
              schoolYear,
              $or: [{ sectionId: null }, { sectionId: { $exists: false } }],
            },
            { $set: { sectionId: section._id } }
          )
          if (updated.modifiedCount > 0) {
            console.log(`  -> Assigned ${updated.modifiedCount} unassigned enrollment(s) to Section A`)
          }
        }
      }
    }

    console.log('\n=== Demo data seed complete ===')
    console.log(`Password for all new accounts: ${PASSWORD}`)
    console.log(`Total parents created/verified: ${PARENTS.length}`)
    console.log(`Total teachers created/verified: ${TEACHERS.length}`)
    console.log(`Total coordinators created/verified: ${COORDINATORS.length}`)
  } catch (error) {
    console.error('Demo data seed failed:', error)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

seedDemoData()
