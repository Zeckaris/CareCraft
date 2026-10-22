import mongoose, { Schema, model } from 'mongoose';
import { IAcademicTerm } from '../types/academicTerm.type.js';


const academicTermSchema = new Schema<IAcademicTerm>(
  {
    calendarId: {
      type: Schema.Types.ObjectId,
      ref: 'AcademicCalendar',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    sequence: { type: Number, required: true },
    startDate: { type: Date, required: false },
    endDate: { type: Date, required: false },
    isCurrent: { type: Boolean, default: false },
  },
  { timestamps: true }
);


// Sequence and name are unique per calendar. Name comparison is case-insensitive.
academicTermSchema.index(
  { calendarId: 1, sequence: 1 },
  { unique: true, name: 'calendar_sequence_unique' }
);
academicTermSchema.index(
  { calendarId: 1, name: 1 },
  { unique: true, name: 'calendar_name_unique', collation: { locale: 'en', strength: 2 } }
);

export const AcademicTerm = model<IAcademicTerm>('AcademicTerm', academicTermSchema);