import { Schema, model } from 'mongoose'
import { ITeachingAssignment } from '../types/teachingAssignment.type.js'

const teachingAssignmentSchema = new Schema<ITeachingAssignment>(
  {
    sectionId: { type: Schema.Types.ObjectId, ref: 'Section', required: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    role: { type: String, enum: ['homeroom', 'subject'], required: true },
    subjectId: { type: Schema.Types.ObjectId, ref: 'Subject', default: null },
    schoolYear: { type: String, required: true, trim: true }, // denormalised from section
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  }
)

// At most one homeroom per section
teachingAssignmentSchema.index(
  { sectionId: 1, role: 1 },
  { unique: true, partialFilterExpression: { role: 'homeroom' } }
)

// At most one teacher per subject per section
teachingAssignmentSchema.index(
  { sectionId: 1, subjectId: 1 },
  { unique: true, partialFilterExpression: { role: 'subject', subjectId: { $type: 'objectId' } } }
)

// Fast lookup: all sections a teacher is in (for "my sections")
teachingAssignmentSchema.index({ teacherId: 1, schoolYear: 1 })

export const TeachingAssignment = model<ITeachingAssignment>(
  'TeachingAssignment',
  teachingAssignmentSchema
)
