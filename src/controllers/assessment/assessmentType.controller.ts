import { Request, Response } from "express"
import { Types } from "mongoose"
import { AssessmentType } from '../../models/assessment/assessmentType.model.js'
import { AssessmentSetup } from '../../models/assessment/assessmentSetup.model.js'
import { AssessmentScore } from '../../models/assessment/assessmentScore.model.js'
import { ConductedAssessment } from '../../models/ConductedAssessment.model.js'
import { recalcMarksheetsForAssessmentType } from '../../service/assessmentScore.service.js'
import { guardDeleteReferences, type ReferenceCheck } from '../../utils/referenceGuard.util.js'
import { sendResponse } from '../../utils/sendResponse.util.js';

export const createAssessmentType = async (req: Request, res: Response): Promise<void> => {
    const { name, weight, description } = req.body
    if (!name || !weight) {
        sendResponse(res, 400, false, "Missing required fields: name, weight")
        return
    }
    if (weight < 0 || weight > 100) {
        sendResponse(res, 400, false, "Weight must be between 0 and 100")
        return
    }
    try {
        const existingType = await AssessmentType.findOne({ name: name.trim() })
        if (existingType) {
            sendResponse(res, 400, false, "Assessment type already exists")
            return
        }

        const newType = new AssessmentType({ 
            name: name.trim(), 
            weight, 
            description 
        })
        await newType.save()
        sendResponse(res, 201, true, "Assessment type created successfully", newType)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const getAllAssessmentTypes = async (req: Request, res: Response): Promise<void> => {
    try {
        const types = await AssessmentType.find().sort({ createdAt: -1 })
        sendResponse(res, 200, true, "Assessment types fetched successfully", types)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const getAssessmentTypeById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    if (!id) {
        sendResponse(res, 400, false, "Missing required field: id")
        return
    }

    try {
        const type = await AssessmentType.findById(id)
        if (!type) {
            sendResponse(res, 404, false, "Assessment type not found")
            return
        }
        sendResponse(res, 200, true, "Assessment type fetched successfully", type)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const updateAssessmentType = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { name, weight, description } = req.body
    if (!id) {
        sendResponse(res, 400, false, "Missing required field: id")
        return
    }
    if (!name && !weight && !description) {
        sendResponse(res, 400, false, "At least one field is required")
        return
    }
    if (weight !== undefined && (weight < 0 || weight > 100)) {
        sendResponse(res, 400, false, "Weight must be between 0 and 100")
        return
    }

    try {
        const type = await AssessmentType.findById(id)
        if (!type) {
            sendResponse(res, 404, false, "Assessment type not found")
            return
        }

        if (name && name.trim() !== type.name) {
            const existingType = await AssessmentType.findOne({ name: name.trim() })
            if (existingType) {
                sendResponse(res, 400, false, "Assessment type name already exists")
                return
            }
        }

        const weightChanged = weight !== undefined && Number(weight) !== Number(type.weight)

        // The weight is the maximum mark for this type. Refuse a reduction that
        // would leave an existing stored mark above the new maximum.
        if (weightChanged && Number(weight) < Number(type.weight)) {
            const offenders = await AssessmentScore.aggregate([
                { $unwind: '$scores' },
                {
                    $match: {
                        'scores.assessmentTypeId': new Types.ObjectId(id),
                        'scores.score': { $gt: Number(weight) },
                    },
                },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        max: { $max: '$scores.score' },
                    },
                },
            ])
            const count = offenders[0]?.count ?? 0
            if (count > 0) {
                const highest = offenders[0].max
                sendResponse(
                    res,
                    400,
                    false,
                    `Cannot reduce "${type.name}" to a maximum of ${weight}: ${count} existing mark(s) exceed it (highest is ${highest}). Keep the maximum at ${highest} or above, or correct those marks first.`
                )
                return
            }
        }

        type.name = name ? name.trim() : type.name
        type.weight = weight !== undefined ? weight : type.weight
        type.description = description || type.description
        await type.save()

        // A weight change alters the average of every marksheet with this type.
        if (weightChanged) {
            await recalcMarksheetsForAssessmentType(id)
        }

        sendResponse(res, 200, true, "Assessment type updated successfully", type)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}


export const deleteAssessmentType = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!id) {
    sendResponse(res, 400, false, "Missing required field: id")
    return
  }

  try {
    const assessmentType = await AssessmentType.findById(id)
    if (!assessmentType) {
      sendResponse(res, 404, false, "Assessment type not found")
      return
    }

    const referenceChecks: ReferenceCheck[] = [
      {
        model: AssessmentSetup,
        field: 'assessmentTypeIds',
        label: 'assessment setup(s)',
      },
      {
        model: ConductedAssessment,
        field: ['conductedStages', 'lockedStages'],
        label: 'conducted assessment(s)',
      },
      {
        model: AssessmentScore,
        field: 'scores.assessmentTypeId',
        label: 'assessment score(s)',
      },
    ]

    if (await guardDeleteReferences(res, 'assessment type', id, referenceChecks)) return

    await AssessmentType.findByIdAndDelete(id)
    sendResponse(res, 200, true, "Assessment type deleted successfully")
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error)
    return;
  }
}
