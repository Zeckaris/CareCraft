import { Types } from 'mongoose'
import { SchoolInfo } from '../models/schoolInfo.model.js'

export const SCHOOL_INFO_SINGLETON_ID = new Types.ObjectId('000000000000000000000001')

export const DEFAULT_SCHOOL_INFO = {
  name: 'School',
  address: 'Not set',
  contactEmail: 'not-set@school.local',
  telephone: [],
  logo: null,
  theme: 'palette-1',
  fontFamily: 'Roboto',
  country: 'Ethiopia',
  timezone: 'Africa/Addis_Ababa',
  academicStructure: 'Semester',
  numberOfPeriods: 2,
  defaultPassingScore: 50,
  gradingSystem: 'Percentage',
  features: {
    attributeEvaluation: false,
    observations: false,
  },
}

export async function ensureSchoolInfo(): Promise<any> {
  const existing = await SchoolInfo.findOne()
  if (existing) return existing

  try {
    return await SchoolInfo.create({
      _id: SCHOOL_INFO_SINGLETON_ID,
      ...DEFAULT_SCHOOL_INFO,
    })
  } catch (error: any) {
    if (error?.code === 11000) {
      const raced = await SchoolInfo.findOne()
      if (raced) return raced
    }
    throw error
  }
}
