import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { connectDB } from './config/database.js';
import cookieParser from 'cookie-parser';
import path from 'path';

//Api router files
import authRouter from './routes/auth.route.js';
import schoolInfoRouter from './routes/admin/schoolInfo.route.js';
import inviteTokenRouter from './routes/admin/inviteToken.route.js';
import studentRouter from './routes/student.route.js';
import { startVerificationCleanup } from './utils/emailVerification.util.js';
import gradeRouter from './routes/grade.route.js';
import subjectRouter from './routes/admin/subject.route.js';
import assessmentTypeRoutes from './routes/assessment/assessmentType.route.js';
import assessmentSetupRoutes from './routes/assessment/assessmentSetup.route.js';
import assessmentScoreRoutes from './routes/assessment/assessmentScore.routes.js';
import gradeSubjectAssessmentRoutes from './routes/admin/gradeSubjectAssessment.route.js';
import studentEnrollmentRouter from './routes/studentEnrollment.route.js';
import observationRouter from './routes/observation.route.js';
import attributeRouter from './routes/attributeCategory.route.js';
import badgeDefinitionRouter from './routes/badgeDefinition.route.js';
import badgeCriteriaRouter from './routes/badgeCriteria.route.js';
import studentBadgeRouter from './routes/studentBadge.route.js';
import actionPlanRouter   from './routes/actionPlan.route.js';
import attributeEvaluationRouter from './routes/attributeEvaluation.route.js';
import sharedPlanTemplateRouter from './routes/sharedPlanTemplate.route.js';
import adminUserRouter from './routes/admin/adminUser.route.js';
import dashboardRouter from './routes/frontendServicingRoutes/dashboard.route.js';
import academicCalendarRouter from './routes/academicCalendar.route.js';
import academicTermRouter from './routes/academicTerm.route.js';
import conductedAssessmentRouter from './routes/conductedAssessment.route.js';
import adminSecurityRouter from './routes/admin/adminSecurity.route.js';
import broadcastMessageRouter from './routes/admin/broadcastMessage.route.js';
import notificationRouter from './routes/notification.route.js';

import './workers/broadcast.worker.js';

// ===== Fix for ESM =====
const rootDir = path.join(import.meta.dirname, '..');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  cors({
    origin: 'http://localhost:5173', 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['set-cookie'],
  })
);
app.use(cookieParser());
app.use('/uploads', express.static(path.join(rootDir, 'uploads')));

// ===== Routes =====
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
app.use('/api/attribute-evaluation', attributeEvaluationRouter);
app.use('/api/badge', badgeDefinitionRouter);
app.use('/api/badgeCriteria', badgeCriteriaRouter);
app.use('/api/studentBadge', studentBadgeRouter);
app.use('/api/actionPlan', actionPlanRouter);
app.use('/api/sharedPlanTemplate', sharedPlanTemplateRouter);
app.use('/api/adminUser', adminUserRouter);
app.use('/api/dashboard', dashboardRouter); 
app.use('/api/calendar', academicCalendarRouter);
app.use('/api/term', academicTermRouter);
app.use('/api/assessment/conducted', conductedAssessmentRouter);
app.use('/api/security', adminSecurityRouter);
app.use('/api/broadcast', broadcastMessageRouter);
app.use('/api/notifications', notificationRouter);

// ===== DB + Server Start =====
connectDB().then(() => {
  app.listen(process.env.PORT, () => 
    console.log(`Server running on port ${process.env.PORT}`)
  );
});

// ===== Background Tasks =====
startVerificationCleanup();