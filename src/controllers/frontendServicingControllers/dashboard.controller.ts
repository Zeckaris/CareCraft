import { Request, Response } from 'express'
import { Student } from '../../models/student.model.js'
import UserAccount from '../../models/userAccount.model.js'
import {
  getAttendanceCompliance,
  getAttendanceSnapshot,
  getChronicAbsentees,
  getClassPerformance,
  getEnrollmentTrend,
  getPerformanceAlerts,
  getRecentActivities,
} from '../../service/dashboard.service.js'
import { sendResponse } from '../../utils/sendResponse.util.js'

function parseActivityLimit(value: unknown): number {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isInteger(parsed) || parsed < 1) return 7
  return Math.min(parsed, 20)
}

function parsePerformanceThreshold(
  value: unknown
): { value: number } | { error: string } {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === '') return { value: 65 }
  const parsed = typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return { error: 'threshold must be a number between 0 and 100' }
  }
  return { value: parsed }
}

function parsePerformanceLimit(
  value: unknown
): { value: number } | { error: string } {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw === undefined || raw === '') return { value: 50 }
  const parsed = typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    return { error: 'limit must be an integer between 1 and 200' }
  }
  return { value: parsed }
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

export const getAttendanceComplianceStats = async (
  _req: Request,
  res: Response
) => {
  try {
    const data = await getAttendanceCompliance()
    return sendResponse(
      res,
      200,
      true,
      'Attendance compliance fetched successfully',
      data
    )
  } catch (error) {
    console.error('Attendance compliance error:', error)
    return sendResponse(
      res,
      500,
      false,
      'Failed to fetch attendance compliance',
      null,
      error instanceof Error ? error.message : 'Internal server error'
    )
  }
}

export const getChronicAbsenteeStats = async (_req: Request, res: Response) => {
  try {
    const data = await getChronicAbsentees()
    return sendResponse(
      res,
      200,
      true,
      'Chronic absentees fetched successfully',
      data
    )
  } catch (error) {
    console.error('Chronic absentees error:', error)
    return sendResponse(
      res,
      500,
      false,
      'Failed to fetch chronic absentees',
      null,
      error instanceof Error ? error.message : 'Internal server error'
    )
  }
}

export const getPerformanceAlertStats = async (req: Request, res: Response) => {
  const threshold = parsePerformanceThreshold(req.query.threshold)
  if ('error' in threshold) {
    return sendResponse(res, 400, false, threshold.error)
  }

  const limit = parsePerformanceLimit(req.query.limit)
  if ('error' in limit) {
    return sendResponse(res, 400, false, limit.error)
  }

  try {
    const data = await getPerformanceAlerts({
      threshold: threshold.value,
      limit: limit.value,
    })
    return sendResponse(
      res,
      200,
      true,
      'Performance alerts fetched successfully',
      data
    )
  } catch (error) {
    console.error('Performance alerts error:', error)
    return sendResponse(
      res,
      500,
      false,
      'Failed to fetch performance alerts',
      null,
      error instanceof Error ? error.message : 'Internal server error'
    )
  }
}
