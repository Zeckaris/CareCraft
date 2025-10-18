import { Document, Types } from 'mongoose'

export interface IGradeSubjectAssessment extends Document {
  _id: Types.ObjectId
  gradeId: Types.ObjectId
  subjectId: Types.ObjectId
  assessmentSetupId: Types.ObjectId
  conductedStages: Types.ObjectId[]
  createdAt: Date
  updatedAt: Date
}
