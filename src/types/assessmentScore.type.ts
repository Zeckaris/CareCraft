import { Types } from 'mongoose'

export interface IAssessmentScore {
  _id?: Types.ObjectId
  studentId: Types.ObjectId
  assessmentSetupId: Types.ObjectId
  scores: [{
    assessmentTypeId: Types.ObjectId
    typeName: string
    score: number
  }]
  result: number
  createdAt?: Date
  updatedAt?: Date
}