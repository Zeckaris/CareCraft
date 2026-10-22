import { Schema, model } from 'mongoose'
import { IGenerationJob } from '../types/generationJob.type.js'

const progressSchema = new Schema(
  {
    phase: {
      type: String,
      enum: ['queued', 'collecting', 'solving', 'validating', 'persisting', 'done', 'failed'],
      default: 'queued',
    },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    message: { type: String, default: null },
  },
  { _id: false }
)

const precheckSchema = new Schema(
  {
    ok: { type: Boolean, default: false },
    errors: { type: Number, default: 0 },
    warnings: { type: Number, default: 0 },
  },
  { _id: false }
)

const droppedLockedSchema = new Schema(
  {
    entryId: { type: String, default: '' },
    sectionId: { type: String, default: '' },
    subjectId: { type: String, default: '' },
    day: { type: String, default: '' },
    period: { type: Number, default: 0 },
    reason: { type: String, default: '' },
  },
  { _id: false }
)

const resultSchema = new Schema(
  {
    scheduleId: { type: Schema.Types.ObjectId, ref: 'Schedule', default: null },
    entryCount: { type: Number, default: 0 },
    unplacedCount: { type: Number, default: 0 },
    stats: { type: Schema.Types.Mixed, default: () => ({}) },
    droppedLocked: { type: [droppedLockedSchema], default: [] },
  },
  { _id: false }
)

const errorSchema = new Schema(
  {
    message: { type: String, required: true },
    code: { type: String, default: null },
  },
  { _id: false }
)

const generationJobSchema = new Schema<IGenerationJob>(
  {
    schoolYear: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
      default: 'queued',
    },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    replaceExistingDraft: { type: Boolean, default: false },
    keepLocked: { type: Boolean, default: false },
    seed: { type: Number, required: true },
    iterationBudget: { type: Number, required: true },
    timeBudgetMs: { type: Number, required: true },
    precheck: { type: precheckSchema, default: null },
    progress: { type: progressSchema, default: () => ({}) },
    result: { type: resultSchema, default: null },
    error: { type: errorSchema, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

// History / latest-by-year lookups.
generationJobSchema.index({ schoolYear: 1, createdAt: -1 })
generationJobSchema.index({ schoolYear: 1, status: 1 })

// At most one active (queued or running) job per school year. `$in` is not
// allowed in a partialFilterExpression, so an explicit `$or` is used.
generationJobSchema.index(
  { schoolYear: 1 },
  {
    unique: true,
    partialFilterExpression: { $or: [{ status: 'queued' }, { status: 'running' }] },
  }
)

export const GenerationJob = model<IGenerationJob>('GenerationJob', generationJobSchema)
