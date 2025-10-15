import dotenv from 'dotenv'
dotenv.config() 

import express from 'express'
import mongoose from 'mongoose'


import authRoutes from './routes/auth.route'
import { connectDB } from './config/database'

const app= express()

app.use(express.json())

app.use('/api/auth', authRoutes)


connectDB().then(() => {
app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`))
})


