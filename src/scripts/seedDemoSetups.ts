import mongoose from 'mongoose'
import { connectDB } from '../config/database.ts'
import { AssessmentSetup } from '../models/assessment/assessmentSetup.model.ts'
import { AssessmentType } from '../models/assessment/assessmentType.model.ts'

const UNIVERSAL_SETUP = {
  name: 'Full Term Assessment',
  description: 'Standard term assessment for all grades and subjects'
}

const seedDemoSetups = async () => {
  try {
    await connectDB()
    console.log('Connected to MongoDB')

    const allTypes = await AssessmentType.find({})
    if (allTypes.length !== 6) {
      console.error('ERROR: Run "npm run seed-types" first!')
      return
    }

    const existingSetup = await AssessmentSetup.findOne({ name: UNIVERSAL_SETUP.name })
    if (existingSetup) {
      console.log('Demo setup already exists, ID:', existingSetup._id)
      console.log('DEFAULT_SETUP_ID =', existingSetup._id)
      return
    }

    const universalSetup = new AssessmentSetup({
      name: UNIVERSAL_SETUP.name,
      description: UNIVERSAL_SETUP.description,
      assessmentTypeIds: allTypes.map(type => type._id)
    })
    await universalSetup.save()

    console.log('SUCCESS! Created Universal Assessment Setup:')
    console.log('  ->', universalSetup.name, '(ID:', universalSetup._id, ')')
    console.log('Contains 6 types (100% total weight)')
    console.log('DEFAULT_SETUP_ID =', universalSetup._id)
    
  } catch (error) {
    console.error('ERROR:', error)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected')
  }
}

seedDemoSetups()