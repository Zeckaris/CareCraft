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


academicTermSchema.pre('save', async function (next) {
  if (this.isCurrent) {
    await (this.constructor as any).updateMany(
      { _id: { $ne: this._id } },
      { isCurrent: false }
    );
  }
  next();
});

export const AcademicTerm = model<IAcademicTerm>('AcademicTerm', academicTermSchema);