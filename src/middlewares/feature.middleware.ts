import { Response, NextFunction } from 'express'
import { AuthRequest } from './auth.middleware.js'
import { isFeatureEnabled, SchoolFeature } from '../service/feature.service.js'
import { sendResponse } from '../utils/sendResponse.util.js'

const FEATURE_DISABLED_MESSAGES: Record<SchoolFeature, string> = {
  attributeEvaluation: 'Attribute evaluation is not enabled for this school',
}

export function requireFeatureForTeachers(feature: SchoolFeature) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.user?.role !== 'teacher') {
        next()
        return
      }

      const enabled = await isFeatureEnabled(feature)
      if (!enabled) {
        sendResponse(res, 403, false, FEATURE_DISABLED_MESSAGES[feature])
        return
      }

      next()
    } catch (error) {
      sendResponse(res, 500, false, 'Server error checking feature availability', null, error)
    }
  }
}
