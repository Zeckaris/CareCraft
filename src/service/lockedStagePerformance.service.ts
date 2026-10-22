import { AssessmentSetup } from '../models/assessment/assessmentSetup.model.js'
import { AssessmentType } from '../models/assessment/assessmentType.model.js'
import { AssessmentScore } from '../models/assessment/assessmentScore.model.js'
import { ConductedAssessment } from '../models/ConductedAssessment.model.js'
import { GradeSubjectAssessment } from '../models/gradeSubjectAssessment.model.js'

/**
 * Shared locked-stage aggregation used by both the dashboard class-performance
 * view and the badge academic-average evaluator.
 *
 * The rules are intentionally identical:
 * - only locked stages participate;
 * - a missing score on a locked stage counts as zero;
 * - lockedWeight is the sum of the locked stage weights;
 * - subjectAverage is lockedScore / lockedWeight * 100.
 */
export function classPerformanceBasePipeline(
  termId: any,
  sectionIds: any[],
  studentId?: any
): any[] {
  const match: any = {
    academicTermId: termId,
    sectionId: { $in: sectionIds },
  }
  if (studentId) match.studentId = studentId

  return [
    { $match: match },
    {
      $lookup: {
        from: ConductedAssessment.collection.name,
        let: { gsaId: '$gsaId', sectionId: '$sectionId', termId: '$academicTermId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$gsaId', '$$gsaId'] },
                  { $eq: ['$sectionId', '$$sectionId'] },
                  { $eq: ['$academicTermId', '$$termId'] },
                ],
              },
            },
          },
        ],
        as: 'conducted',
      },
    },
    { $unwind: '$conducted' },
    {
      $lookup: {
        from: GradeSubjectAssessment.collection.name,
        localField: 'gsaId',
        foreignField: '_id',
        as: 'gsa',
      },
    },
    { $unwind: '$gsa' },
    {
      $lookup: {
        from: AssessmentSetup.collection.name,
        localField: 'gsa.assessmentSetupId',
        foreignField: '_id',
        as: 'setup',
      },
    },
    { $unwind: '$setup' },
    {
      $lookup: {
        from: AssessmentType.collection.name,
        localField: 'setup.assessmentTypeIds',
        foreignField: '_id',
        as: 'setupTypes',
      },
    },
    {
      $addFields: {
        lockedTypes: {
          $filter: {
            input: '$setupTypes',
            as: 'type',
            cond: {
              $in: ['$$type._id', { $ifNull: ['$conducted.lockedStages', []] }],
            },
          },
        },
      },
    },
    {
      $addFields: {
        lockedTypeIds: {
          $map: {
            input: '$lockedTypes',
            as: 'type',
            in: '$$type._id',
          },
        },
      },
    },
    {
      $project: {
        academicTermId: 1,
        sectionId: 1,
        studentId: 1,
        gsaId: 1,
        subjectId: '$gsa.subjectId',
        lockedStageCount: { $size: '$lockedTypes' },
        lockedWeight: {
          $sum: {
            $map: {
              input: '$lockedTypes',
              as: 'type',
              in: { $ifNull: ['$$type.weight', 0] },
            },
          },
        },
        lockedScore: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: '$scores',
                  as: 'score',
                  cond: { $in: ['$$score.assessmentTypeId', '$lockedTypeIds'] },
                },
              },
              as: 'score',
              in: { $ifNull: ['$$score.score', 0] },
            },
          },
        },
        lockedTypeIds: 1,
      },
    },
    {
      $match: {
        lockedStageCount: { $gt: 0 },
        lockedWeight: { $gt: 0 },
      },
    },
    {
      $project: {
        academicTermId: 1,
        sectionId: 1,
        studentId: 1,
        gsaId: 1,
        subjectId: 1,
        lockedStageCount: 1,
        lockedTypeIds: 1,
        lockedScore: 1,
        lockedWeight: 1,
        subjectAverage: {
          $multiply: [{ $divide: ['$lockedScore', '$lockedWeight'] }, 100],
        },
      },
    },
  ]
}
