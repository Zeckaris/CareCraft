import { Types } from 'mongoose'

/**
 * A single assessment type's mark on a student's marksheet.
 *
 * `score` is the mark obtained, on a scale of 0 up to that type's weight (the
 * weight is the maximum mark). Only entries that have actually been written are
 * stored; the class-sheet read supplies a default of 0 for conducted stages
 * that have no entry.
 */
export interface IAssessmentScoreEntry {
  assessmentTypeId: Types.ObjectId
  score: number
}

/**
 * One marksheet = one student, for one GradeSubjectAssessment (grade+subject),
 * in one academic term, in one section.
 *
 * The school year is denormalised from the section so marksheets remain
 * queryable after a section is archived.
 */
export interface IAssessmentScore {
  _id?: Types.ObjectId
  studentId: Types.ObjectId
  gsaId: Types.ObjectId
  sectionId: Types.ObjectId
  academicTermId: Types.ObjectId
  schoolYear: string
  scores: IAssessmentScoreEntry[]
  /** Sum of marks over conducted stages (null when none conducted). */
  total: number | null
  /** total / sum of conducted weights * 100 (null when none conducted). */
  average: number | null
  createdAt?: Date
  updatedAt?: Date
}
