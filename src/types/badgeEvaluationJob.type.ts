export interface IEvaluateStudentJobData {
  studentId: string
}

export interface IEvaluateSectionJobData {
  sectionId: string
}

export interface IEvaluateBadgeJobData {
  badgeId: string
}

export type BadgeEvaluationJobData =
  | IEvaluateStudentJobData
  | IEvaluateSectionJobData
  | IEvaluateBadgeJobData
  | Record<string, never>

export type BadgeEvaluationJobName =
  | 'evaluate-student'
  | 'evaluate-section'
  | 'evaluate-badge'
  | 'nightly-sweep'
