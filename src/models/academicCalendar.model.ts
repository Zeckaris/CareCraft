import {Schema, model} from 'mongoose'
import { IAcademicCalendar } from '../types/academicCalendar.type.js'

const AcademicCalendarSchema = new Schema<IAcademicCalendar>({
    academicYear : {type : String, required : true, unique: true,
      trim: true,
      match: /^\d{4}-\d{4}$/}, 
    startDate: {type : Date, required: true}, 
    endDate : {type : Date, required: true}, 
    isCurrent : {type: Boolean, default : false}
},
{
    timestamps: true

})

AcademicCalendarSchema.pre('save', async function(next) {
    if (this.isCurrent) {
        await (this.constructor as any).updateMany(
            { _id: { $ne: this._id } },
            { isCurrent: false }
        );
    }
    next();
});

export const AcademicCalendar = model<IAcademicCalendar>('AcademicCalendar', AcademicCalendarSchema)