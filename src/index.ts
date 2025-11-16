import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { connectDB } from './config/database.ts';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

//Api router files
import authRouter from './routes/auth.route.ts';
import schoolInfoRouter from './routes/admin/schoolInfo.route.ts';
import inviteTokenRouter from './routes/admin/inviteToken.route.ts';
import studentRouter from './routes/student.route.ts';
import { startVerificationCleanup } from './utils/emailVerification.util.ts';
import gradeRouter from './routes/grade.route.ts';
import subjectRouter from './routes/admin/subject.route.ts';
import assessmentTypeRoutes from './routes/assessment/assessmentType.route.ts';
import assessmentSetupRoutes from './routes/assessment/assessmentSetup.route.ts';
import assessmentScoreRoutes from './routes/assessment/assessmentScore.routes.ts'
import gradeSubjectAssessmentRoutes from './routes/admin/gradeSubjectAssessment.route.ts';
import studentEnrollmentRouter from './routes/studentEnrollment.route.ts'
import observationRouter from './routes/observation.route.ts';
import attributeRouter from './routes/attributeCategory.route.ts';
import badgeDefinitionRouter from './routes/badgeDefinition.route.ts';
import badgeCriteriaRouter from './routes/badgeCriteria.route.ts';
import studentBadgeRouter from './routes/studentBadge.route.ts';
import actionPlanRouter   from './routes/actionPlan.route.ts';
import attributeEvaluationRouter from './routes/attributeEvaluation.route.ts';
import sharedPlanTemplateRouter from './routes/sharedPlanTemplate.route.ts';
import adminUserRouter from './routes/admin/adminUser.route.ts';
import dashboardRouter from './routes/frontendServicingRoutes/dashboard.route.ts'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');


const app= express()

app.use(express.urlencoded({ extended: true }));
app.use(express.json())
app.use(
  cors({
    origin: 'http://localhost:5173', 
    credentials: true,               // ALLOW COOKIES
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['set-cookie'],
  })
);
app.use(cookieParser());
app.use('/uploads', express.static(path.join(rootDir, 'uploads')));




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
app.use('/api/enrollment', studentEnrollmentRouter);
app.use('/api/observation', observationRouter);
app.use('/api/attribute', attributeRouter);
app.use('/api/attributeEvaluation', attributeEvaluationRouter);
app.use('/api/badge', badgeDefinitionRouter);
app.use('/api/badgeCriteria', badgeCriteriaRouter);
app.use('/api/studentBadge', studentBadgeRouter);
app.use('/api/actionPlan', actionPlanRouter);
app.use('/api/sharedPlanTemplate', sharedPlanTemplateRouter);
app.use('/api/adminUser', adminUserRouter);
app.use('/api/dashboard', dashboardRouter)


connectDB().then(() => {
app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`))
})

startVerificationCleanup();

