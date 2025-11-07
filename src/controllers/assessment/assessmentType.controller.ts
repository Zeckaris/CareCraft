import { Request, Response } from "express"
import { AssessmentType } from "../../models/assessment/assessmentType.model.ts"
import { GradeSubjectAssessment } from "../../models/gradeSubjectAssessment.model.ts" 
import { AssessmentSetup } from "../../models/assessment/assessmentSetup.model.ts"
import { sendResponse } from '../../utils/sendResponse.util.ts';

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
    if (weight && (weight < 0 || weight > 100)) {
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

        type.name = name ? name.trim() : type.name
        type.weight = weight !== undefined ? weight : type.weight
        type.description = description || type.description
        await type.save()

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
    // Correct field name for AssessmentSetup
    const usedInSetup = await AssessmentSetup.findOne({ assessmentTypeIds: id })
    const usedInGSA = await GradeSubjectAssessment.findOne({ conductedStages: id })

    if (usedInSetup || usedInGSA) {
      const usedPlaces: string[] = []
      if (usedInSetup) usedPlaces.push("Assessment Setup")
      if (usedInGSA) usedPlaces.push("Grade Subject Assessment")

      sendResponse(res, 400, false, `Cannot delete assessment type because it is referenced in: ${usedPlaces.join(", ")}. Please delete or update the referenced setup(s) before removing this assessment type.`, {
        references: {
          setupId: usedInSetup?._id || null,
          gradeSubjectAssessmentId: usedInGSA?._id || null,
        }
      })
      return
    }

    const deletedType = await AssessmentType.findByIdAndDelete(id)
    if (!deletedType) {
      sendResponse(res, 404, false, "Assessment type not found")
      return
    }

    sendResponse(res, 200, true, "Assessment type deleted successfully")
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error)
    return;
  }
}
