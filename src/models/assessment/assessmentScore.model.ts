import { Schema, model, Types } from 'mongoose'
import { IAssessmentScore } from '../../types/assessment/assessmentScore.type.js'

const assessmentScoreSchema = new Schema<IAssessmentScore>(
  {
    studentId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Student', 
      required: true 
    },
    gsaId:{
      type: Schema.Types.ObjectId,
      ref: 'GradeSubjectAssessment',
      required: true
    },
    assessmentSetupId: { 
      type: Schema.Types.ObjectId, 
      ref: 'AssessmentSetup', 
      required: true 
    },
    scores: [{
      assessmentTypeId: { 
        type: Schema.Types.ObjectId, 
        ref: 'AssessmentType', 
        required: true 
      },
      typeName: { 
        type: String, 
        required: true 
      },
      score: { 
        type: Number, 
        required: true, 
        min: 0, 
        max: 100 
      }
    }],
    result: { 
      type: Number, 
      required: true, 
      min: 0, 
      max: 100 
    }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
)

export const AssessmentScore = model<IAssessmentScore>(
  'AssessmentScore', 
  assessmentScoreSchema
)