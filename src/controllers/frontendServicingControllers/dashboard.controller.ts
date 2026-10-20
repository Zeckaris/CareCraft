import { Request, Response } from 'express'
import { Student } from '../../models/student.model.js'
import UserAccount from '../../models/userAccount.model.js'
import {
  getAttendanceSnapshot,
  getClassPerformance,
  getEnrollmentTrend,
  getRecentActivities,
} from '../../service/dashboard.service.js'
import { sendResponse } from '../../utils/sendResponse.util.js'

function parseActivityLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isInteger(parsed) || parsed < 1) return 7
  return Math.min(parsed, 20)
}

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const [totalStudents, totalTeachers, genderCounts, enrollmentTrend, recentActivities] =
      await Promise.all([
        Student.countDocuments(),
        UserAccount.countDocuments({ role: 'teacher' }),
        Student.aggregate([
          {
            $group: {
              _id: '$gender',
              count: { $sum: 1 },
            },
          },
          {
            $project: {
              _id: 0,
              name: '$_id',
              value: '$count',
            },
          },
        ]),
        getEnrollmentTrend(),
        getRecentActivities(parseActivityLimit(req.query.activityLimit)),
      ])

    const data = {
      summary: {
        totalStudents,
        totalTeachers,
      },
      genderBreakdown:
        genderCounts.length > 0
          ? genderCounts
          : [
              { name: 'Male', value: 0 },
              { name: 'Female', value: 0 },
            ],
      enrollmentTrend,
      recentActivities,
    }

    return sendResponse(
      res,
      200,
      true,
      'Dashboard stats fetched successfully',
      data
    )
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return sendResponse(
      res,
      500,
      false,
      'Failed to fetch dashboard stats',
      null,
      error instanceof Error ? error.message : 'Internal server error'
    )
  }
}

export const getAttendanceSnapshotStats = async (_req: Request, res: Response) => {
  try {
    const data = await getAttendanceSnapshot()
    return sendResponse(
      res,
      200,
      true,
      'Attendance snapshot fetched successfully',
      data
    )
  } catch (error) {
    console.error('Attendance snapshot error:', error)
    return sendResponse(
      res,
      500,
      false,
      'Failed to fetch attendance snapshot',
      null,
      error instanceof Error ? error.message : 'Internal server error'
    )
  }
}

export const getClassPerformanceStats = async (_req: Request, res: Response) => {
  try {
    const data = await getClassPerformance()
    return sendResponse(
      res,
      200,
      true,
      'Class performance fetched successfully',
      data
    )
  } catch (error) {
    console.error('Class performance error:', error)
    return sendResponse(
      res,
      500,
      false,
      'Failed to fetch class performance',
      null,
      error instanceof Error ? error.message : 'Internal server error'
    )
  }
}
