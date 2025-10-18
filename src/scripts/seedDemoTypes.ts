import mongoose from 'mongoose'
import { connectDB } from '../config/database'
import { AssessmentType } from '../models/assessment/assessmentType.model'

const DEMO_TYPES = [
  { name: 'Test 1', weight: 10, description: 'First term test' },
  { name: 'Individual Assignment', weight: 10, description: 'Personal homework' },
  { name: 'Group Assignment', weight: 15, description: 'Team project' },
  { name: 'Quiz', weight: 5, description: 'Short assessment' },
  { name: 'Test 2', weight: 20, description: 'Second term test' },
  { name: 'Final Exam', weight: 40, description: 'End of term exam' }
]

const seedDemoTypes = async () => {
  try {
    await connectDB()
    console.log('Connected to MongoDB')

    const existing = await AssessmentType.find({})
    const existingNames = existing.map(t => t.name)

    const newTypes = DEMO_TYPES.filter(type => !existingNames.includes(type.name))
    
    if (newTypes.length === 0) {
      console.log('All demo types already exist')
      return
    }

    const createdTypes = await AssessmentType.insertMany(newTypes)
    
    console.log('SUCCESS! Created', newTypes.length, 'new Assessment Types:')
    newTypes.forEach(type => {
      console.log('  ->', type.name, type.weight + '%')
    })
    
    console.log('TOTAL WEIGHT:', createdTypes.reduce((sum, t) => sum + t.weight, 0) + '%')
    console.log('Run: npm run seed-setups')

  } catch (error) {
    console.error('ERROR:', error)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected')
  }
}

seedDemoTypes()