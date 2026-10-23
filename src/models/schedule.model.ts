import { Schema, model } from 'mongoose'
import { ISchedule } from '../types/schedule.type.js'

const softBreakdownSchema = new Schema(
  {
    spreadSubjectAcrossWeek: { type: Number, default: 0 },
    varyPeriodPosition: { type: Number, default: 0 },
    teacherIdleGaps: { type: Number, default: 0 },
    teacherLoadBalance: { type: Number, default: 0 },
    teacherRunLength: { type: Number, default: 0 },
  },
  { _id: false }
)

const statsSchema = new Schema(
  {
    seed: { type: Number, default: 0 },
    restarts: { type: Number, default: 0 },
    iterations: { type: Number, default: 0 },
    elapsedMs: { type: Number, default: 0 },
    timedOut: { type: Boolean, default: false },
    hardViolations: { type: Number, default: 0 },
    softScore: { type: Number, default: 0 },
    softBreakdown: { type: softBreakdownSchema, default: () => ({}) },
    unplacedCount: { type: Number, default: 0 },
  },
  { _id: false }
)

const unplacedSchema = new Schema(
  {
    lessonId: { type: String, required: true },
    sectionId: { type: String, required: true },
    gradeId: { type: String, default: '' },
    subjectId: { type: String, required: true },
    teacherId: { type: String, default: '' },
    periods: { type: Number, default: 0 },
    reason: { type: String, default: 'NO_FEASIBLE_SLOT' },
    reasons: { type: Map, of: Number, default: () => new Map() },
  },
  { _id: false }
)

const scheduleSchema = new Schema<ISchedule>(
  {
    schoolYear: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'School year must be in format YYYY-YYYY (e.g., 2024-2025)'],
    },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'draft',
    },
    fingerprint: { type: String, default: '' },
    settingsSnapshot: { type: Schema.Types.Mixed, default: null },
    entryCount: { type: Number, default: 0 },
    stats: { type: statsSchema, default: () => ({}) },
    unplaced: { type: [unplacedSchema], default: [] },
    version: { type: Number, default: 0 },
    publishedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'UserAccount', default: null },
    allowUnplacedOverride: { type: Boolean, default: false },
    clonedFrom: { type: Schema.Types.ObjectId, ref: 'Schedule', default: null },
    generatedBy: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    generatedAt: { type: Date, default: () => new Date() },
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

// Lookup by year + status.
scheduleSchema.index({ schoolYear: 1, status: 1 })
scheduleSchema.index({ schoolYear: 1, createdAt: -1 })

// At most one draft per school year, enforced at the database level. The
// generation flow frees this slot before inserting the replacement draft: any
// existing draft is first moved out of `draft` (to `archived`), the new draft is
// inserted, and only then is the archived draft deleted together with its
// entries. A concurrent insert therefore fails with a duplicate-key error that
// the generation job reports as `DRAFT_CONFLICT` rather than corrupting state.
scheduleSchema.index(
  { schoolYear: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'draft' },
    name: 'schoolYear_1_draft_unique',
  }
)

// At most one published schedule per school year. Publishing archives the
// previously published schedule first, so this slot is freed before the new one
// is written (mirroring the draft-uniqueness flow above).
scheduleSchema.index(
  { schoolYear: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'published' },
    name: 'schoolYear_1_published_unique',
  }
)

export const Schedule = model<ISchedule>('Schedule', scheduleSchema)
