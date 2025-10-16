import dotenv from 'dotenv'
dotenv.config() 

import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import { connectDB } from './config/database'

//Api router files
import authRoutes from './routes/auth.route'


const app= express()

app.use(express.json())
app.use(cors({
    origin: '*',  // To be modified later
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}))

app.use('/api/auth', authRoutes)


connectDB().then(() => {
app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`))
})


