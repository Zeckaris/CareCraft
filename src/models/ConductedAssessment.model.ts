import mongoose, { Schema, model } from 'mongoose';
import { IConductedAssessment } from '../types/ConductedAssessment.type.js';


const conductedAssessmentSchema = new Schema<IConductedAssessment>(
  {
    gsaId: {
      type: Schema.Types.ObjectId,
      ref: 'GradeSubjectAssessment',
      required: true,
    },
    academicTermId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicTerm',
      required: true,
    },
    conductedStages: [
      {
        type: Schema.Types.ObjectId,
        ref: 'AssessmentType',
      },
    ],
    status: {
      type: String,
      enum: ['planned', 'in-progress', 'completed'],
      default: 'planned',
    }
  },
  { timestamps: true }
);



export const ConductedAssessment = model<IConductedAssessment>(
  'ConductedAssessment',
  conductedAssessmentSchema
);