import { Schema, model, Types } from 'mongoose'
import { IStudentAssessmentResult, IStudentAssessmentScore } from '../types/studentAssessmentResult.type'

const studentAssessmentScoreSchema = new Schema<IStudentAssessmentScore>(
  {
    typeId: { type: Schema.Types.ObjectId, ref: 'AssessmentType', required: true },
    score: { type: Number, required: true }
  },
  { _id: false }
)

const studentAssessmentResultSchema = new Schema<IStudentAssessmentResult>(
  {
    studentEnrollmentId: { type: Schema.Types.ObjectId, ref: 'StudentEnrollment', required: true },
    gradeSubjectAssessmentId: { type: Schema.Types.ObjectId, ref: 'GradeSubjectAssessment', required: true },
    scores: { type: [studentAssessmentScoreSchema], default: [] },
    totalScore: { type: Number, required: true },
    gradeLetter: { type: String, required: true, trim: true },
    feedback: { type: String, default: null }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
)

export const StudentAssessmentResult = model<IStudentAssessmentResult>(
  'StudentAssessmentResult',
  studentAssessmentResultSchema
)
