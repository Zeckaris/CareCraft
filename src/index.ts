import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { connectDB } from './config/database';

//Api router files
import authRouter from './routes/auth.route';
import schoolInfoRouter from './routes/admin/schoolInfo.route';
import inviteTokenRouter from './routes/admin/inviteToken.route';
import studentRouter from './routes/student.route';
import { startVerificationCleanup } from './utils/emailVerification.util';
import gradeRouter from './routes/grade.route';
import subjectRouter from './routes/admin/subject.route';
import assessmentTypeRoutes from './routes/assessment/assessmentType.route';
import assessmentSetupRoutes from './routes/assessment/assessmentSetup.route';
import assessmentScoreRoutes from './routes/assessment/assessmentScore.routes'
import gradeSubjectAssessmentRoutes from './routes/admin/gradeSubjectAssessment.route';

const app= express()

app.use(express.json())
app.use(cors({
    origin: '*',  // To be modified later
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/api/auth', authRouter);
app.use("/api/general", schoolInfoRouter);
app.use('/api/adminstrator', inviteTokenRouter);
app.use('/api/student', studentRouter);
app.use('/api/grade', gradeRouter);
app.use('/api/subject', subjectRouter);
app.use('/api/assessment/type', assessmentTypeRoutes);
app.use('/api/assessment/setup', assessmentSetupRoutes);
app.use('/api/assessment/scores', assessmentScoreRoutes);
app.use('/api/assessment/gsa', gradeSubjectAssessmentRoutes);



connectDB().then(() => {
app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`))
})

startVerificationCleanup();

