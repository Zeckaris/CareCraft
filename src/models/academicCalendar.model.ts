import { Schema, model } from 'mongoose';
import { IAcademicCalendar } from '../types/academicCalendar.type.js';

const AcademicCalendarSchema = new Schema<IAcademicCalendar>(
  {
    academicYear: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^\d{4}-\d{4}$/, 'Academic year must be in format YYYY-YYYY (e.g., 2025-2026)'],
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    isCurrent: {
      type: Boolean,
      default: false,
    },

    registrationStartDate: {
      type: Date,
      required: false,
    },
    registrationEndDate: {
      type: Date,
      required: false,
    },
    newStudentRegistrationStartDate: {
      type: Date,
      required: false,
    },
    newStudentRegistrationEndDate: {
      type: Date,
      required: false,
    },
    holidayDates: {
      type: [Date],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

AcademicCalendarSchema.pre('save', async function (next) {
  if (this.isCurrent) {
    await (this.constructor as any).updateMany(
      { _id: { $ne: this._id } },
      { isCurrent: false }
    );
  }
  next();
});

export const AcademicCalendar = model<IAcademicCalendar>(
  'AcademicCalendar',
  AcademicCalendarSchema
);