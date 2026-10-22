import { Request, Response } from 'express'
import { Student } from '../../models/student.model.js'
import mongoose, { Types } from 'mongoose'
import { StudentEnrollment } from '../../models/studentEnrollment.model.js'
import { Observation } from '../../models/observation.model.js'
import { Attendance } from '../../models/attendance.model.js'
import { AssessmentScore } from '../../models/assessment/assessmentScore.model.js'
import { AttributeEvaluation } from '../../models/attributeEvaluation.model.js'
import { StudentBadge } from '../../models/studentBadge.model.js'
import { ActionPlan } from '../../models/actionPlan.model.js'
import { Report } from '../../models/report.model.js'
import { FlaggedIssue } from '../../models/flaggedIssue.model.js'
import { ChatRoom } from '../../models/chatRoom.model.js'
import { Notification } from '../../models/notification.model.js'
import { InviteToken } from '../../models/inviteToken.model.js'
import { BadgeAwardSuppression } from '../../models/badgeAwardSuppression.model.js'
import { guardDeleteReferences, ReferenceCheck } from '../../utils/referenceGuard.util.js'
import { sendResponse } from '../../utils/sendResponse.util.js' 
import { logAudit } from '../../utils/auditLogger.util.js'
import { AuthRequest } from '../../middlewares/auth.middleware.js'

// Cloudinary integration
import { uploadToCloudinary, deleteFromCloudinary } from '../../utils/cloudinary.util.js';

export const createStudent = async (req: AuthRequest, res: Response): Promise<void> => {

  let profileImage = '';  
  if (req.file) {
    const { url } = await uploadToCloudinary(
      req.file.buffer,
      'avatars',  // Cloudinary folder
      undefined,
      'image'
    );
    profileImage = url;
  }

  const {
    firstName,
    middleName,
    lastName,
    gender,
    dateOfBirth,
  } = req.body;

  if (!firstName || !lastName || !gender || !dateOfBirth) {
    sendResponse(res, 400, false, 'Missing required fields.');
    return;
  }

  const normalizedGender = gender.trim().charAt(0).toUpperCase();
  if (!['M', 'F'].includes(normalizedGender)) {
    sendResponse(res, 400, false, 'Gender must be M or F (e.g., Male, Female, m, f).');
    return;
  }

  const admissionDate = Date.now();

  try {
    const newStudent = await Student.create({
      firstName,
      middleName,
      lastName,
      gender: normalizedGender,
      dateOfBirth,
      admissionDate,
      profileImage, 
    });

    await logAudit(req, {
      type: 'student_create',
      action: 'created',
      entity: `${newStudent.firstName} ${newStudent.lastName}`,
      target: '', 
    });

    sendResponse(res, 201, true, 'Student created successfully.', newStudent);
  } catch (error) {
    sendResponse(res, 500, false, 'Error creating student.', null, error);
    return;
  }
};



import {
  assertTeacherCanReadStudent,
  assertParentOwnsStudent,
  getTeacherSectionIds,
} from '../../middlewares/access.middleware.js'

export const getAllStudents = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    let limit = parseInt(req.query.limit as string) || 10;
    limit = Math.min(limit, 50);
    const skip = (page - 1) * limit;

    const { gradeId, sectionId, section } = req.query; 

    // Build filter
    const filter: any = {};
    const targetSectionId = sectionId || section;

    const user = req.user;
    if (user?.role === 'parent') {
      filter.parentId = user.id;
    } else if (user?.role === 'teacher') {
      const teacherSectionIds = await getTeacherSectionIds(user.id);
      if (teacherSectionIds.length === 0) {
        sendResponse(res, 200, true, 'Students fetched successfully.', [], null, {
          total: 0,
          page,
          limit,
        });
        return;
      }
      const enrollmentFilter: any = { sectionId: { $in: teacherSectionIds }, isActive: true };
      if (gradeId) enrollmentFilter.gradeId = gradeId;
      if (targetSectionId) {
        if (!teacherSectionIds.some((sId) => sId.toString() === targetSectionId.toString())) {
          sendResponse(res, 403, false, 'Forbidden: You are not assigned to this section');
          return;
        }
        enrollmentFilter.sectionId = targetSectionId;
      }
      const matchingEnrollments = await StudentEnrollment.find(enrollmentFilter).select('_id');
      filter.enrollmentId = { $in: matchingEnrollments.map((e) => e._id) };
    } else if (gradeId || targetSectionId) {
      const enrollmentFilter: any = {};
      if (gradeId) enrollmentFilter.gradeId = gradeId;
      if (targetSectionId) enrollmentFilter.sectionId = targetSectionId;
      const matchingEnrollments = await StudentEnrollment.find(enrollmentFilter).select('_id');
      filter.enrollmentId = { $in: matchingEnrollments.map((e) => e._id) };
    }

    const total = await Student.countDocuments(filter);

    const students = await Student.find(filter)
      .populate({
        path: 'enrollmentId',
        select: 'gradeId sectionId schoolYear isActive',
        populate: [
          { path: 'gradeId', select: 'level' },
          { path: 'sectionId', select: 'name' }
        ]
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


export const getStudentById = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Invalid student ID.')
    return
  }

  try {
    const student = await Student.findById(id)
      .populate({
        path: 'enrollmentId',
        select: 'gradeId sectionId schoolYear isActive',
        populate: [
          { path: 'gradeId', select: 'level' },
          { path: 'sectionId', select: 'name' }
        ]
      })
      .populate('parentId', 'firstName lastName email phoneNumber')

    if (!student) {
      sendResponse(res, 404, false, 'Student not found.')
      return
    }

    const user = req.user
    if (user?.role === 'parent') {
      await assertParentOwnsStudent(user.id, student._id)
    } else if (user?.role === 'teacher') {
      await assertTeacherCanReadStudent(user.id, student._id)
    }

    sendResponse(res, 200, true, 'Student fetched successfully.', student)
  } catch (error: any) {
    sendResponse(
      res,
      error.statusCode || 500,
      false,
      error.message || 'Error fetching student.',
      null,
      error
    )
  }
}


export const updateStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Invalid student ID.')
    return
  }

  let { firstName, middleName, lastName, gender, dateOfBirth } = req.body

  let profileImage: string | undefined;
  if (req.file) {
    const student = await Student.findById(id);
    if (!student) {
      sendResponse(res, 404, false, 'Student not found.')
      return
    }

    // Delete old image if exists
    if (student.profileImage) {
      try {
        const urlParts = student.profileImage.split('/');
        const filenameWithExt = urlParts[urlParts.length - 1];
        const publicId = urlParts.slice(-2, -1)[0] + '/' + filenameWithExt.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (deleteErr) {
        console.warn('Failed to delete old Cloudinary avatar:', deleteErr);
      }
    }

    const { url } = await uploadToCloudinary(
      req.file.buffer,
      'avatars',
      undefined,
      'image'
    );
    profileImage = url;
  }

  if (gender !== undefined) {
    const normalizedGender = gender.trim().charAt(0).toUpperCase()
    if (!['M', 'F'].includes(normalizedGender)) {
      sendResponse(res, 400, false, 'Gender must be M or F (e.g., Male, Female, m, f).')
      return
    }
    req.body.gender = normalizedGender
  }

  try {
    const updatedStudent = await Student.findByIdAndUpdate(id, {
      ...req.body,
      ...(profileImage && { profileImage }),  // Only update if new image uploaded
    }, { new: true, runValidators: true })
    if (!updatedStudent) {
      sendResponse(res, 404, false, 'Student not found.')
      return
    }

    await logAudit(req, {
    type: 'student_update',
    action: 'updated',
    entity: `${updatedStudent.firstName} ${updatedStudent.lastName}`,
    target: '', 
  });
    sendResponse(res, 200, true, 'Student updated successfully.', updatedStudent)
  } catch (error) {
    sendResponse(res, 500, false, 'Error updating student.', null, error)
    return;
  }
}


export const deleteStudent = async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params

  if (!mongoose.Types.ObjectId.isValid(id)) {
    sendResponse(res, 400, false, 'Invalid student ID.')
    return
  }

  try {
    const student = await Student.findById(id)
    if (!student) {
      sendResponse(res, 404, false, 'Student not found.')
      return
    }

    const referenceChecks: ReferenceCheck[] = [
      { model: StudentEnrollment, field: 'studentId', label: 'enrollment(s)' },
      { model: Attendance, field: 'studentId', label: 'attendance record(s)' },
      { model: AssessmentScore, field: 'studentId', label: 'assessment score(s)' },
      { model: AttributeEvaluation, field: 'studentId', label: 'attribute evaluation(s)' },
      { model: Observation, field: 'studentId', label: 'observation(s)' },
      { model: StudentBadge, field: 'studentId', label: 'student badge(s)' },
      { model: ActionPlan, field: 'studentId', label: 'action plan(s)' },
      { model: Report, field: 'studentId', label: 'report(s)' },
      { model: FlaggedIssue, field: 'studentId', label: 'flagged issue(s)' },
      { model: ChatRoom, field: 'studentId', label: 'chat room(s)' },
    ]

    if (await guardDeleteReferences(res, 'student', id, referenceChecks, { person: true })) {
      return
    }

    await Promise.all([
      Notification.deleteMany({ studentId: id }),
      InviteToken.deleteMany({ createdFor: id }),
      BadgeAwardSuppression.deleteMany({ studentId: id }),
    ])

    const deletedStudent = await Student.findByIdAndDelete(id)
    if (!deletedStudent) {
      sendResponse(res, 404, false, 'Student not found.')
      return
    }

    // Optional: delete avatar from Cloudinary on delete
    if (deletedStudent.profileImage) {
      try {
        const urlParts = deletedStudent.profileImage.split('/');
        const filenameWithExt = urlParts[urlParts.length - 1];
        const publicId = urlParts.slice(-2, -1)[0] + '/' + filenameWithExt.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (deleteErr) {
        console.warn('Failed to delete Cloudinary avatar on student delete:', deleteErr);
      }
    }

await logAudit(req, {
    type: 'student_delete',
    action: 'deleted',
    entity: `${deletedStudent.firstName} ${deletedStudent.lastName}`,
    target: '', 
  });
    sendResponse(res, 200, true, 'Student deleted successfully.')
  } catch (error) {
     sendResponse(res, 500, false, 'Error deleting student.', null, error)
     return;
  }
}


export const getStudentsByGrade = async (req: AuthRequest, res: Response): Promise<void> => {
    const gradeId = req.params.gradeId || (req.query.gradeId as string)
    
    if (!gradeId) {
        sendResponse(res, 400, false, 'Missing: gradeId')
        return
    }

    const user = req.user
    if (user?.role === 'parent') {
        sendResponse(res, 403, false, 'Forbidden: Parents cannot access grade rosters')
        return
    }

    try {

      const page = parseInt(req.query.page as string) || 1
      let limit = parseInt(req.query.limit as string) || 10
      limit = Math.min(limit, 50) // Max 50 per page
      const skip = (page - 1) * limit

      const enrollmentFilter: any = { 
        gradeId, 
        isActive: true 
      }

      if (user?.role === 'teacher') {
        const teacherSectionIds = await getTeacherSectionIds(user.id)
        if (teacherSectionIds.length === 0) {
          sendResponse(res, 200, true, 'Students fetched successfully.', [], null, {
            total: 0,
            page,
            limit
          })
          return
        }
        enrollmentFilter.sectionId = { $in: teacherSectionIds }
      }

      const total = await StudentEnrollment.countDocuments(enrollmentFilter)

      const enrollments = await StudentEnrollment.find(enrollmentFilter)
          .populate('studentId', 'firstName lastName gender profileImage')
          .skip(skip)
          .limit(limit)

      if (enrollments.length === 0) {
          sendResponse(res, 200, true, 'No active students found.', [], null, {
            total: 0,
            page,
            limit
          })
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