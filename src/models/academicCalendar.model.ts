import {Schema, model} from 'mongoose'
import { IAcademicCalendar } from '../types/academicCalendar.type'

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