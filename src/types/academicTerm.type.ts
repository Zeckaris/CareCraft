import { Document, Types } from "mongoose";

export interface IAcademicTerm extends Document {
    calendarId: Types.ObjectId;
    name: string;
    sequence: number;
    startDate: Date;
    endDate: Date;
    isCurrent: boolean;
}