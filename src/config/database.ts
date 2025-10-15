import mongoose from 'mongoose'

const mongoURI = process.env.MONGO_URI

if (!mongoURI) {
  throw new Error('MONGO_URI is not defined in .env')
}

export const connectDB = async () => {
  try {
    await mongoose.connect(mongoURI)
    console.log('MongoDB connected successfully')
  } catch (error) {
    console.error('MongoDB connection failed:', error)
    process.exit(1) 
  }
}


