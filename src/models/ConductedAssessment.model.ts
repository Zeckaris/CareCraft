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
    /** Which section these conducted stages belong to */
    sectionId: {
      type: Schema.Types.ObjectId,
      ref: 'Section',
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

// One conducted-assessment record per GSA + term + section
conductedAssessmentSchema.index(
  { gsaId: 1, academicTermId: 1, sectionId: 1 },
  { unique: true }
);

export const ConductedAssessment = model<IConductedAssessment>(
  'ConductedAssessment',
  conductedAssessmentSchema
);