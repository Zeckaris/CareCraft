import { Document, Types } from 'mongoose'

export type GenerationJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type GenerationJobPhase =
  | 'queued'
  | 'collecting'
  | 'solving'
  | 'validating'
  | 'persisting'
  | 'done'
  | 'failed'

export interface GenerationJobProgress {
  phase: GenerationJobPhase
  percent: number
  message?: string | null
}

export interface GenerationJobPrecheckSummary {
  ok: boolean
  errors: number
  warnings: number
}

export interface GenerationJobDroppedLocked {
  entryId: string
  sectionId: string
  subjectId: string
  day: string
  period: number
  reason: string
}

export interface GenerationJobResult {
  scheduleId: Types.ObjectId
  entryCount: number
  unplacedCount: number
  stats: Record<string, unknown>
  droppedLocked?: GenerationJobDroppedLocked[]
}

export interface GenerationJobError {
  message: string
  code?: string
}

export interface IGenerationJob extends Document {
  _id: Types.ObjectId
  schoolYear: string // canonical YYYY-YYYY
  status: GenerationJobStatus
  requestedBy: Types.ObjectId
  replaceExistingDraft: boolean
  keepLocked: boolean
  seed: number
  iterationBudget: number
  timeBudgetMs: number
  precheck: GenerationJobPrecheckSummary | null
  progress: GenerationJobProgress
  result: GenerationJobResult | null
  error: GenerationJobError | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}
