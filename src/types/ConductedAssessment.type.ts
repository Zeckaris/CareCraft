import { Document, Types } from 'mongoose';

export interface IConductedAssessment extends Document {
  gsaId: Types.ObjectId;           // ref: GradeSubjectAssessment
  academicTermId: Types.ObjectId;  // ref: AcademicTerm
  conductedStages: Types.ObjectId[]; // ref: AssessmentType (ordered)
  status: 'planned' | 'in-progress' | 'completed';
  createdAt: Date;
  updatedAt: Date;
}