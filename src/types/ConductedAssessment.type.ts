import { Document, Types } from 'mongoose';

export interface IConductedAssessment extends Document {
  gsaId: Types.ObjectId;           // ref: GradeSubjectAssessment
  academicTermId: Types.ObjectId;  // ref: AcademicTerm
  /** Per-section tracking: stages conducted for this specific section */
  sectionId: Types.ObjectId;       // ref: Section (required; one record per GSA+term+section)
  conductedStages: Types.ObjectId[]; // ref: AssessmentType (ordered, setup order)
  /**
   * Subset of conductedStages whose scores are locked (stage completed).
   * Invariant: lockedStages is always a subset of conductedStages.
   */
  lockedStages: Types.ObjectId[];  // ref: AssessmentType
  status: 'planned' | 'in-progress' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}