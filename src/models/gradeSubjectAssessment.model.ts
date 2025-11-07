import { Schema, model, Types } from 'mongoose'
import { IGradeSubjectAssessment } from '../types/gradeSubjectAssessment.type.ts';

const gradeSubjectAssessmentSchema = new Schema<IGradeSubjectAssessment>(
  {
    gradeId: { type: Schema.Types.ObjectId, ref: 'Grade', required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', required: true },
    assessmentSetupId: { type: Schema.Types.ObjectId, ref: 'AssessmentSetup', required: true },
    conductedStages: [{  
    type: Schema.Types.ObjectId, 
    ref: 'AssessmentType'
    }]
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
  }
)

export const GradeSubjectAssessment = model<IGradeSubjectAssessment>(
  'GradeSubjectAssessment', 
  gradeSubjectAssessmentSchema
)