import { Request, Response } from 'express'
import { Student } from '../../models/student.model'
import mongoose from 'mongoose'
import { StudentEnrollment } from '../../models/studentEnrollment.model'



export const createStudent = async (req: Request, res: Response): Promise<void> => {
  const {
    firstName,
    middleName,
    lastName,
    gender,
    dateOfBirth,
    profileImage,
  } = req.body

  if (!firstName || !lastName || !gender || !dateOfBirth) {
    res.status(400).json({ message: 'Missing required fields.' })
    return
  }

  const admissionDate= Date.now()

  try {
    const newStudent = await Student.create({
      firstName,
      middleName,
      lastName,
      gender,
      dateOfBirth,
      admissionDate,
      profileImage,
    })

    res.status(201).json({
      message: 'Student created successfully.',
      student: newStudent,
    })
  } catch (error) {
    res.status(500).json({ message: 'Error creating student.', error })
  }
}


export const getAllStudents = async (_req: Request, res: Response): Promise<void> => {
  try {
    const students = await Student.find().populate('enrollmentId').populate('parentId')
    res.status(200).json({ students })
  } catch (error) {
    res.status(500).json({ message: 'Error fetching students.', error })
  }
}


export const getStudentById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: 'Invalid student ID.' })
    return
  }

  try {
    const student = await Student.findById(id).populate('enrollmentId').populate('parentId')
    if (!student) {
      res.status(404).json({ message: 'Student not found.' })
      return
    }
    res.status(200).json({ student })
  } catch (error) {
    res.status(500).json({ message: 'Error fetching student.', error })
  }
}


export const updateStudent = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: 'Invalid student ID.' })
    return
  }

  try {
    const updatedStudent = await Student.findByIdAndUpdate(id, req.body, { new: true, runValidators: true })
    if (!updatedStudent) {
      res.status(404).json({ message: 'Student not found.' })
      return
    }
    res.status(200).json({ message: 'Student updated successfully.', student: updatedStudent })
  } catch (error) {
    res.status(500).json({ message: 'Error updating student.', error })
  }
}


export const deleteStudent = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: 'Invalid student ID.' })
    return
  }

  try {
    const deletedStudent = await Student.findByIdAndDelete(id)
    if (!deletedStudent) {
      res.status(404).json({ message: 'Student not found.' })
      return
    }
    res.status(200).json({ message: 'Student deleted successfully.' })
  } catch (error) {
    res.status(500).json({ message: 'Error deleting student.', error })
  }
}


export const getStudentsByGrade = async (req: Request, res: Response): Promise<void> => {
    const { gradeId } = req.params
    
    if (!gradeId) {
        res.status(400).json({ message: "Missing: gradeId" })
        return
    }

    try {
        const enrollments = await StudentEnrollment.find({ 
            gradeId, 
            isActive: true 
        }).populate('studentId') 

        if (enrollments.length === 0) {
            res.status(400).json({ message: "No active students found" })
            return
        }

        const students = enrollments.map(en => ({
            id: en.studentId?._id || en.studentId,
            name: `${(en.studentId as any)?.firstName || ''} ${(en.studentId as any)?.lastName || ''}`.trim()
        }))

        res.status(200).json({ 
            students, 
            count: students.length 
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}