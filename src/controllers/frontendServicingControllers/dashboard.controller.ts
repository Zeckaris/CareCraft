import { Request, Response } from 'express'
import { Student } from '../../models/student.model'
import { StudentEnrollment } from '../../models/studentEnrollment.model'
import { Grade } from '../../models/grade.model'
import UserAccount from '../../models/userAccount.model'
import { sendResponse } from '../../utils/sendResponse.util'
import { AuditLog } from '../../models/auditLog.model';

// Extract start year from "2024-25" → 2024
const extractStartYear = (schoolYear: string): number => {
  const [start] = schoolYear.split('-');
  return parseInt(start, 10);
};

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const [
      totalStudents,
      totalTeachers,
      genderCounts,
      enrollmentRaw,
      recentActivities
    ] = await Promise.all([
      // 1. Total Students
      Student.countDocuments(),

      // 2. Total Teachers
      UserAccount.countDocuments({ role: 'teacher' }),

      // 3. Gender Breakdown
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

      // 4. Enrollment Trend: All years (historical + current)
      StudentEnrollment.aggregate([
        {
          $lookup: {
            from: 'grades',
            localField: 'gradeId',
            foreignField: '_id',
            as: 'grade',
          },
        },
        {
          $unwind: '$grade',
        },
        {
          $group: {
            _id: {
              grade: '$grade.level',
              year: '$schoolYear',
            },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            grade: '$_id.grade',
            year: '$_id.year',
            count: 1,
          },
        },
      ]),

    AuditLog.find()
    .sort({ createdAt: -1 })
    .limit(7)
    .lean(),

    ]);

    

    // Transform enrollment into pivot: { grade, 2023, 2024, 2025 }
    const gradeMap = new Map<string, any>();

    enrollmentRaw.forEach(({ grade, year, count }) => {
      const startYear = extractStartYear(year).toString();
      if (!gradeMap.has(grade)) {
        gradeMap.set(grade, { grade });
      }
      gradeMap.get(grade)[startYear] = count;
    });

    const enrollmentTrend = Array.from(gradeMap.values()).sort((a, b) => {
      const numA = parseInt(a.grade.replace('Grade ', ''), 10);
      const numB = parseInt(b.grade.replace('Grade ', ''), 10);
      return numA - numB;
    });

    const formattedActivities = recentActivities.map(a => ({
    id: a._id.toString(),
    action: a.type,            
    entity: a.message,         
    target: '',              
    user: a.actor.toString(),  
    timestamp: a.createdAt  
    }));

    const data = {
      summary: {
        totalStudents,
        totalTeachers,
      },
      genderBreakdown: genderCounts.length > 0
        ? genderCounts
        : [
            { name: 'Male', value: 0 },
            { name: 'Female', value: 0 },
          ],
      enrollmentTrend,
      recentActivities: formattedActivities,
    };

    return sendResponse(
      res,
      200,
      true,
      'Dashboard stats fetched successfully',
      data
    );
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return sendResponse(
      res,
      500,
      false,
      'Failed to fetch dashboard stats',
      null,
      error instanceof Error ? error.message : 'Internal server error'
    );
  }
};