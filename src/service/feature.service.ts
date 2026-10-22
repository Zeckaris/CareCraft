import { SchoolInfo } from '../models/schoolInfo.model.js'
import { ISchoolFeatures } from '../types/schoolInfo.type.js'

export type SchoolFeature = keyof ISchoolFeatures

const DEFAULT_FEATURES: ISchoolFeatures = {
  attributeEvaluation: false,
  observations: false,
}

export function normalizeFeatures(features: Partial<ISchoolFeatures> | null | undefined): ISchoolFeatures {
  return {
    attributeEvaluation: features?.attributeEvaluation === true,
    observations: features?.observations === true,
  }
}

export async function getSchoolFeatures(): Promise<ISchoolFeatures> {
  const schoolInfo = await SchoolInfo.findOne().select('features').lean()
  return normalizeFeatures(schoolInfo?.features)
}

export async function isFeatureEnabled(feature: SchoolFeature): Promise<boolean> {
  const features = await getSchoolFeatures()
  return features[feature] === true
}

export function getDefaultFeatures(): ISchoolFeatures {
  return { ...DEFAULT_FEATURES }
}
