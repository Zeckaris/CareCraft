import { Schema, model } from 'mongoose'
import { IAssessmentScore } from '../../types/assessment/assessmentScore.type.js'

const assessmentScoreSchema = new Schema<IAssessmentScore>(
  {
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
    },
    gsaId: {
      type: Schema.Types.ObjectId,
      ref: 'GradeSubjectAssessment',
      required: true,
    },
    sectionId: {
      type: Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
    },
    academicTermId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicTerm',
      required: true,
    },
    schoolYear: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    scores: [
      {
        assessmentTypeId: {
          type: Schema.Types.ObjectId,
          ref: 'AssessmentType',
          required: true,
        },
        // The mark obtained, on a scale of 0..(this type's weight). The upper
        // bound is the type's weight, so it cannot be clamped here; it is
        // validated against the type in the service.
        score: {
          type: Number,
          required: true,
        },
      },
    ],
    total: { type: Number, default: null },
    average: { type: Number, default: null },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

// One marksheet per student, per GSA, per term, per section.
assessmentScoreSchema.index(
  { studentId: 1, gsaId: 1, academicTermId: 1, sectionId: 1 },
  { unique: true }
)

// Class-sheet read: all marksheets for a section + term + GSA.
assessmentScoreSchema.index({ sectionId: 1, academicTermId: 1, gsaId: 1 })

export const AssessmentScore = model<IAssessmentScore>(
  'AssessmentScore',
  assessmentScoreSchema
)
