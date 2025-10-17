import dotenv from 'dotenv';
dotenv.config() 

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import { connectDB } from './config/database';

//Api router files
import authRoutes from './routes/auth.route';
import schoolInfoRoutes from './routes/schoolInfo.route';
import inviteTokenRouter from './routes/inviteToken.route';
import studentRouter from './routes/student.route';
import { startVerificationCleanup } from './utils/emailVerification.util';


const app= express()

app.use(express.json())
app.use(cors({
    origin: '*',  // To be modified later
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use('/api/auth', authRoutes);
app.use("/api/general", schoolInfoRoutes);
app.use('/api/adminstrator', inviteTokenRouter);
app.use('/api/student', studentRouter);


connectDB().then(() => {
app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`))
})

startVerificationCleanup();

