import { Schema, model, Types } from 'mongoose'
import { IStudent } from '../types/student.type'

const studentSchema = new Schema<IStudent>(
  {
    firstName: { type: String, required: true, trim: true },
    middleName: { type: String, default: '' },
    lastName: { type: String, required: true, trim: true },
    gender: { type: String, required: true, trim: true },
    dateOfBirth: { type: Date, required: true },
    enrollmentId: { type: Schema.Types.ObjectId, ref: 'StudentEnrollment', required: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'UserAccount', required: true },
    admissionDate: { type: Date, required: true },
    profileImage: { type: String, default: '' }
  },
  {
    timestamps: { createdAt: 'createdAt', updatedAt: false }
  }
)

export const Student = model<IStudent>('Student', studentSchema)
