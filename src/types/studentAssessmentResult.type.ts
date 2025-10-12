import { Document, Types } from 'mongoose'

export interface IStudentAssessmentScore {
  typeId: Types.ObjectId
  score: number
}

export interface IStudentAssessmentResult extends Document {
  _id: Types.ObjectId
  studentEnrollmentId: Types.ObjectId
  gradeSubjectAssessmentId: Types.ObjectId
  scores: IStudentAssessmentScore[] 
  totalScore: number
  gradeLetter: string
  feedback?: string | null
  createdAt: Date
  updatedAt: Date
}
