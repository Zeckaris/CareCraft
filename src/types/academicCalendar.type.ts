import { Document, Types } from 'mongoose';

export interface IAcademicCalendar extends Document {
  academicYear: string;                         
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
  registrationStartDate?: Date;                  
  registrationEndDate?: Date;                     
  newStudentRegistrationStartDate?: Date;         
  newStudentRegistrationEndDate?: Date;         
  holidayDates: Date[];                           

  createdAt: Date;
  updatedAt: Date;
}