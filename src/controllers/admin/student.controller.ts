import { Request, Response } from 'express'
import { Student } from '../../models/student.model.ts'
import mongoose from 'mongoose'
import { StudentEnrollment } from '../../models/studentEnrollment.model.ts'
import { sendResponse } from '../../utils/sendResponse.util.ts' 



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

  const normalizedGender = gender.trim().charAt(0).toUpperCase()
  if (!['M', 'F'].includes(normalizedGender)) {
    sendResponse(res, 400, false, 'Gender must be M or F (e.g., Male, Female, m, f).')
    return
  }

  const admissionDate= Date.now()

  try {
    const newStudent = await Student.create({
      firstName,
      middleName,
      lastName,
      gender: normalizedGender,
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
    const page = parseInt(req.query.page as string) || 1;
    let limit = parseInt(req.query.limit as string) || 10;
    limit = Math.min(limit, 50);
    const skip = (page - 1) * limit;

    const { gradeId } = req.query; 

    // Build filter
    const filter: any = {};
    if (gradeId) {
      filter['enrollmentId.gradeId'] = gradeId;
    }

    const total = await Student.countDocuments(filter);

    const students = await Student.find(filter)
      .populate({
        path: 'enrollmentId',
        select: 'gradeId schoolYear isActive',
        populate: { path: 'gradeId', select: 'level' }
      })
      .populate('parentId', 'firstName lastName email phoneNumber')
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    sendResponse(res, 200, true, 'Students fetched successfully.', students, null, {
      total,
      page,
      limit
    });
  } catch (error) {
    sendResponse(res, 500, false, 'Error fetching students.', null, error);
  }
};


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

  const { gender } = req.body

  if (gender !== undefined) {
    const normalizedGender = gender.trim().charAt(0).toUpperCase()
    if (!['M', 'F'].includes(normalizedGender)) {
      sendResponse(res, 400, false, 'Gender must be M or F (e.g., Male, Female, m, f).')
      return
    }
    req.body.gender = normalizedGender
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