import { Request, Response } from 'express'
import mongoose from 'mongoose'
import { TeachingAssignment } from '../models/teachingAssignment.model.js'
import { Section } from '../models/section.model.js'
import { GradeSubjectAssessment } from '../models/gradeSubjectAssessment.model.js'
import UserAccount from '../models/userAccount.model.js'
import { Subject } from '../models/subject.model.js'
import { sendResponse } from '../utils/sendResponse.util.js'

// ─── CREATE ───────────────────────────────────────────────────────────────────

/** POST /api/teaching-assignment
 *  Roles: admin, coordinator
 *
 *  Body: { sectionId, teacherId, role, subjectId? }
 *    role: 'homeroom' | 'subject'
 *    subjectId: required when role === 'subject'
 */
export const createTeachingAssignment = async (req: Request, res: Response): Promise<void> => {
  const { sectionId, teacherId, role, subjectId } = req.body

  if (!sectionId || !teacherId || !role) {
    sendResponse(res, 400, false, 'Missing required fields: sectionId, teacherId, role')
    return
  }
  if (!['homeroom', 'subject'].includes(role)) {
    sendResponse(res, 400, false, 'role must be "homeroom" or "subject"')
    return
  }
  if (role === 'subject' && !subjectId) {
    sendResponse(res, 400, false, 'subjectId is required when role is "subject"')
    return
  }
  if (!mongoose.isValidObjectId(sectionId) || !mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Invalid sectionId or teacherId')
    return
  }
  if (subjectId && !mongoose.isValidObjectId(subjectId)) {
    sendResponse(res, 400, false, 'Invalid subjectId')
    return
  }

  try {
    // Validate section
    const section = await Section.findById(sectionId)
    if (!section) {
      sendResponse(res, 404, false, 'Section not found')
      return
    }
    if (!section.isActive) {
      sendResponse(res, 400, false, 'Cannot assign to an inactive section')
      return
    }

    // Validate teacher
    const teacher = await UserAccount.findById(teacherId)
    if (!teacher || teacher.role !== 'teacher') {
      sendResponse(res, 400, false, 'Teacher not found or user is not a teacher')
      return
    }
    if (teacher.isSuspended) {
      sendResponse(res, 400, false, 'Cannot assign a suspended teacher')
      return
    }

    // For subject role: ensure GSA exists for section's grade + subject
    if (role === 'subject') {
      const subject = await Subject.findById(subjectId)
      if (!subject) {
        sendResponse(res, 404, false, 'Subject not found')
        return
      }
      const gsa = await GradeSubjectAssessment.findOne({ gradeId: section.gradeId, subjectId })
      if (!gsa) {
        sendResponse(
          res,
          400,
          false,
          `No GradeSubjectAssessment found for this grade and subject. Create one first.`
        )
        return
      }
    }

    // Uniqueness check for homeroom: one per section
    if (role === 'homeroom') {
      const existingHomeroom = await TeachingAssignment.findOne({ sectionId, role: 'homeroom' })
      if (existingHomeroom) {
        sendResponse(res, 400, false, 'This section already has a homeroom teacher. Reassign instead.')
        return
      }
    }

    // Uniqueness check for subject: one teacher per subject per section
    if (role === 'subject') {
      const existingSubject = await TeachingAssignment.findOne({ sectionId, role: 'subject', subjectId })
      if (existingSubject) {
        sendResponse(
          res,
          400,
          false,
          'A teacher is already assigned to this subject in this section. Reassign instead.'
        )
        return
      }
    }

    const assignment = await TeachingAssignment.create({
      sectionId,
      teacherId,
      role,
      subjectId: role === 'subject' ? subjectId : null,
      schoolYear: section.schoolYear,
    })

    const populated = await TeachingAssignment.findById(assignment._id)
      .populate({ path: 'sectionId', populate: { path: 'gradeId', select: 'level' } })
      .populate('teacherId', 'firstName lastName email role')
      .populate('subjectId', 'name description')

    sendResponse(res, 201, true, 'Teaching assignment created successfully', populated)
  } catch (error) {
    sendResponse(res, 500, false, 'Server error creating teaching assignment', null, error)
  }
}

// ─── GET ALL ─────────────────────────────────────────────────────────────────

/** GET /api/teaching-assignment
 *  Roles: admin, coordinator, teacher (teachers receive filtered results — full filtering handled here)
 *  Query: sectionId, teacherId, role, schoolYear
 */
export const getAllTeachingAssignments = async (req: Request, res: Response): Promise<void> => {
  const { sectionId, teacherId, role, schoolYear, page = 1, limit = 50 } = req.query
  const skip = (Number(page) - 1) * Number(limit)
  const filter: any = {}

  if (sectionId) {
    if (!mongoose.isValidObjectId(sectionId)) { sendResponse(res, 400, false, 'Invalid sectionId'); return }
    filter.sectionId = sectionId
  }
  const currentUser = (req as any).user
  if (currentUser?.role === 'teacher') {
    filter.teacherId = currentUser.id
  } else if (teacherId) {
    if (!mongoose.isValidObjectId(teacherId)) { sendResponse(res, 400, false, 'Invalid teacherId'); return }
    filter.teacherId = teacherId
  }
  if (role) {
    if (!['homeroom', 'subject'].includes(role as string)) { sendResponse(res, 400, false, 'Invalid role'); return }
    filter.role = role
  }
  if (schoolYear) filter.schoolYear = schoolYear

  try {
    const total = await TeachingAssignment.countDocuments(filter)
    const assignments = await TeachingAssignment.find(filter)
      .populate({ path: 'sectionId', populate: { path: 'gradeId', select: 'level description' } })
      .populate('teacherId', 'firstName lastName email role')
      .populate('subjectId', 'name description')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))

    sendResponse(res, 200, true, 'Teaching assignments fetched successfully', assignments, null, {
      total,
      page: Number(page),
      limit: Number(limit),
    })
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching teaching assignments', null, error)
  }
}

/** GET /api/teaching-assignment/:id */
export const getTeachingAssignmentById = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) { sendResponse(res, 400, false, 'Invalid ID'); return }

  try {
    const assignment = await TeachingAssignment.findById(id)
      .populate({ path: 'sectionId', populate: { path: 'gradeId', select: 'level description' } })
      .populate('teacherId', 'firstName lastName email role')
      .populate('subjectId', 'name description')

    if (!assignment) { sendResponse(res, 404, false, 'Teaching assignment not found'); return }

    const currentUser = (req as any).user
    if (currentUser?.role === 'teacher') {
      const assignedTeacherId = (assignment.teacherId as any)?._id?.toString() || assignment.teacherId?.toString()
      if (assignedTeacherId !== currentUser.id) {
        sendResponse(res, 403, false, 'Forbidden: You can only view your own teaching assignments')
        return
      }
    }

    sendResponse(res, 200, true, 'Teaching assignment fetched successfully', assignment)
  } catch (error) {
    sendResponse(res, 500, false, 'Server error fetching teaching assignment', null, error)
  }
}

// ─── REASSIGN (change teacher only) ──────────────────────────────────────────

/** PATCH /api/teaching-assignment/:id/reassign
 *  Roles: admin, coordinator
 *  Only the teacher can be changed; section, role, subject and year are immutable.
 *  Body: { teacherId }
 */
export const reassignTeacher = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const { teacherId } = req.body

  if (!mongoose.isValidObjectId(id)) { sendResponse(res, 400, false, 'Invalid assignment ID'); return }
  if (!teacherId || !mongoose.isValidObjectId(teacherId)) {
    sendResponse(res, 400, false, 'Valid teacherId required')
    return
  }

  try {
    const assignment = await TeachingAssignment.findById(id)
    if (!assignment) { sendResponse(res, 404, false, 'Teaching assignment not found'); return }

    const teacher = await UserAccount.findById(teacherId)
    if (!teacher || teacher.role !== 'teacher') {
      sendResponse(res, 400, false, 'Teacher not found or user is not a teacher')
      return
    }
    if (teacher.isSuspended) {
      sendResponse(res, 400, false, 'Cannot reassign to a suspended teacher')
      return
    }

    assignment.teacherId = new mongoose.Types.ObjectId(teacherId)
    await assignment.save()

    const populated = await TeachingAssignment.findById(id)
      .populate({ path: 'sectionId', populate: { path: 'gradeId', select: 'level' } })
      .populate('teacherId', 'firstName lastName email role')
      .populate('subjectId', 'name description')

    sendResponse(res, 200, true, 'Teacher reassigned successfully', populated)
  } catch (error) {
    sendResponse(res, 500, false, 'Server error reassigning teacher', null, error)
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

/** DELETE /api/teaching-assignment/:id
 *  Roles: admin, coordinator
 */
export const deleteTeachingAssignment = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!mongoose.isValidObjectId(id)) { sendResponse(res, 400, false, 'Invalid ID'); return }

  try {
    const assignment = await TeachingAssignment.findByIdAndDelete(id)
    if (!assignment) { sendResponse(res, 404, false, 'Teaching assignment not found'); return }
    sendResponse(res, 200, true, 'Teaching assignment deleted successfully')
  } catch (error) {
    sendResponse(res, 500, false, 'Server error deleting teaching assignment', null, error)
  }
}
