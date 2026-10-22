import bcrypt from 'bcrypt'
import mongoose from 'mongoose'
import { connectDB } from '../config/database.js'
import { SchoolInfo } from '../models/schoolInfo.model.js'
import UserAccount from '../models/userAccount.model.js'

const BOOTSTRAP_SCHOOL = {
  name: 'CareCraft Demo School',
  address: 'Bahrain',
  contactEmail: 'info@carecraft.demo',
  contactPhone: '+97300000000',
  country: 'Bahrain',
  timezone: 'Asia/Bahrain'
}

const BOOTSTRAP_ADMIN = {
  firstName: 'Demo',
  lastName: 'Admin',
  email: 'test@example.com',
  password: 'password123',
  role: 'admin' as const,
  phoneNumber: '+97300000000'
}

const BOOTSTRAP_TEACHER = {
  firstName: 'Demo',
  lastName: 'Teacher',
  email: 'teacher@carecraft.demo',
  password: 'password123',
  role: 'teacher' as const,
  phoneNumber: '+97300000001'
}

const BOOTSTRAP_STUDENT = {
  firstName: 'Demo',
  lastName: 'Student',
  email: 'student@carecraft.demo',
  password: 'password123',
  role: 'student' as const,
  phoneNumber: '+97300000002'
}

const seedBootstrap = async () => {
  try {
    await connectDB()

    const existingSchool = await SchoolInfo.findOne({ name: BOOTSTRAP_SCHOOL.name })
    const school = existingSchool ?? await SchoolInfo.create(BOOTSTRAP_SCHOOL)

    const existingAdmin = await UserAccount.findOne({ email: BOOTSTRAP_ADMIN.email })
    const hashedAdminPassword = await bcrypt.hash(BOOTSTRAP_ADMIN.password, 10)
    const admin = existingAdmin ?? await UserAccount.create({
      ...BOOTSTRAP_ADMIN,
      password: hashedAdminPassword
    })

    const existingTeacher = await UserAccount.findOne({ email: BOOTSTRAP_TEACHER.email })
    const hashedTeacherPassword = await bcrypt.hash(BOOTSTRAP_TEACHER.password, 10)
    const teacher = existingTeacher ?? await UserAccount.create({
      ...BOOTSTRAP_TEACHER,
      password: hashedTeacherPassword
    })

    const existingStudent = await UserAccount.findOne({ email: BOOTSTRAP_STUDENT.email })
    const hashedStudentPassword = await bcrypt.hash(BOOTSTRAP_STUDENT.password, 10)
    const student = existingStudent ?? await UserAccount.create({
      ...BOOTSTRAP_STUDENT,
      password: hashedStudentPassword
    })

    console.log('Bootstrap data ready:')
    console.log('School:', school.name)
    console.log('Admin:', admin.email)
    console.log('Teacher:', teacher.email)
    console.log('Student:', student.email)
    console.log('Default password for all demo accounts: Password123')
  } catch (error) {
    console.error('Bootstrap failed:', error)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}

seedBootstrap()
