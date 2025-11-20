import {Document} from 'mongoose'

export interface IAcademicCalendar extends Document{
    academicYear : string;
    startDate : Date;
    endDate: Date;
    isCurrent: boolean;
    createdAt: Date;
    updatedAt: Date;
}