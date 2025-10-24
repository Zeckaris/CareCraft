import { Request, Response } from 'express'
import { Student } from '../../models/student.model'
import mongoose from 'mongoose'
import { StudentEnrollment } from '../../models/studentEnrollment.model'
import { sendResponse } from '../../utils/sendResponse.util' 



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
    sendResponse(res, 400, false, 'Missing required fields.')
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

    sendResponse(res, 201, true, 'Student created successfully.', newStudent)
  } catch (error) {
    sendResponse(res, 500, false, 'Error creating student.', null, error)
    return;
  }
}


export const getAllStudents = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1
    let limit = parseInt(req.query.limit as string) || 10
    limit = Math.min(limit, 50) // Max 50 per page
    const skip = (page - 1) * limit

    const total = await Student.countDocuments()

    const students = await Student.find()
      .populate('enrollmentId', 'gradeId schoolYear isActive')
      .populate('parentId', 'firstName lastName email phoneNumber')
      .skip(skip)
      .limit(limit)
    
    sendResponse(res, 200, true, 'Students fetched successfully.', students, null, {
      total,
      page,
      limit
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Error fetching students.', null, error)
  }
}


export const getStudentById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Invalid student ID.')
    return
  }

  try {
    const student = await Student.findById(id)
      .populate('enrollmentId', 'gradeId schoolYear isActive')
      .populate('parentId', 'firstName lastName email phoneNumber')
    if (!student) {
      sendResponse(res, 404, false, 'Student not found.')
      return
    }
    sendResponse(res, 200, true, 'Student fetched successfully.', student)
  } catch (error) {
    sendResponse(res, 500, false, 'Error fetching student.', null, error)
    return;
  }
}


export const updateStudent = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Invalid student ID.')
    return
  }

  try {
    const updatedStudent = await Student.findByIdAndUpdate(id, req.body, { new: true, runValidators: true })
    if (!updatedStudent) {
      sendResponse(res, 404, false, 'Student not found.')
      return
    }
    sendResponse(res, 200, true, 'Student updated successfully.', updatedStudent)
  } catch (error) {
    sendResponse(res, 500, false, 'Error updating student.', null, error)
    return;
  }
}


export const deleteStudent = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Invalid student ID.')
    return
  }

  try {
    const deletedStudent = await Student.findByIdAndDelete(id)
    if (!deletedStudent) {
      sendResponse(res, 404, false, 'Student not found.')
      return
    }
    sendResponse(res, 200, true, 'Student deleted successfully.')
  } catch (error) {
     sendResponse(res, 500, false, 'Error deleting student.', null, error)
     return;
  }
}


export const getStudentsByGrade = async (req: Request, res: Response): Promise<void> => {
    const { gradeId } = req.params
    
    if (!gradeId) {
        sendResponse(res, 400, false, 'Missing: gradeId')
        return
    }

    try {

      const page = parseInt(req.query.page as string) || 1
      let limit = parseInt(req.query.limit as string) || 10
      limit = Math.min(limit, 50) // Max 50 per page
      const skip = (page - 1) * limit

      const total = await StudentEnrollment.countDocuments({ 
        gradeId, 
        isActive: true 
      })


        const enrollments = await StudentEnrollment.find({ 
            gradeId, 
            isActive: true 
        }).populate('studentId', 'firstName lastName gender profileImage')
          .skip(skip)
          .limit(limit)

        if (enrollments.length === 0) {
            sendResponse(res, 404, false, 'No active students found.')
            return
        }

        const students = enrollments.map(en => ({
            id: en.studentId?._id || en.studentId,
            name: `${(en.studentId as any)?.firstName || ''} ${(en.studentId as any)?.lastName || ''}`.trim()
        }))

       sendResponse(res, 200, true, 'Students fetched successfully.', students, null, {
          total,
          page,
          limit
        })

    } catch (error) {
        sendResponse(res, 500, false, 'Internal server error', null, error)
        return;
    }
}