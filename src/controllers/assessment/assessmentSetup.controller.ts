import { Request, Response } from "express"
import { AssessmentSetup } from '../../models/assessment/assessmentSetup.model.js'
import { AssessmentType } from '../../models/assessment/assessmentType.model.js'
import { AssessmentScore } from '../../models/assessment/assessmentScore.model.js'
import { GradeSubjectAssessment } from '../../models/gradeSubjectAssessment.model.js'
import { sendResponse } from '../../utils/sendResponse.util.js'

export const createAssessmentSetup = async (req: Request, res: Response): Promise<void> => {
    const { name, description, assessmentTypeIds } = req.body
    if (!name || !assessmentTypeIds || !Array.isArray(assessmentTypeIds)) {
        sendResponse(res, 400, false, "Missing required fields: name, assessmentTypeIds (array)")
        return
    }
    if (assessmentTypeIds.length === 0) {
        sendResponse(res, 400, false, "At least one assessment type required")
        return
    }

    try {
        const existingSetup = await AssessmentSetup.findOne({ name: name.trim() })
        if (existingSetup) {
            sendResponse(res, 400, false, "Assessment setup already exists")
            return
        }
        const validTypes = await AssessmentType.find({ _id: { $in: assessmentTypeIds } })
        if (validTypes.length !== assessmentTypeIds.length) {
            sendResponse(res, 400, false, "One or more assessment types not found")
            return
        }

        const totalWeight = validTypes.reduce((sum, type) => sum + type.weight, 0)
        if (totalWeight !== 100) {
            sendResponse(res, 400, false, `Total weight must equal 100%. Current: ${totalWeight}%`, {
                types: validTypes.map(t => ({ name: t.name, weight: t.weight }))
            })
            return
        }

        const newSetup = new AssessmentSetup({ 
            name: name.trim(), 
            description, 
            assessmentTypeIds 
        })
        await newSetup.save()
        sendResponse(res, 201, true, "Assessment setup created successfully", {
            setup: newSetup,
            totalWeight: `${totalWeight}%`
        })
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const getAllAssessmentSetups = async (req: Request, res: Response): Promise<void> => {
    try {
        const setups = await AssessmentSetup.find()
            .populate('assessmentTypeIds', 'name weight description')
            .sort({ createdAt: -1 })
        sendResponse(res, 200, true, "Assessment setups fetched successfully", setups)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const getAssessmentSetupById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    if (!id) {
        sendResponse(res, 400, false, "Missing required field: id")
        return
    }

    try {
        const setup = await AssessmentSetup.findById(id)
            .populate('assessmentTypeIds', 'name weight description')
        if (!setup) {
            sendResponse(res, 404, false, "Assessment setup not found")
            return
        }
        sendResponse(res, 200, true, "Assessment setup fetched successfully", setup)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const updateAssessmentSetup = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { name, description, assessmentTypeIds } = req.body
    if (!id) {
        sendResponse(res, 400, false, "Missing required field: id")
        return
    }
    if (!name && !description && (!assessmentTypeIds || !Array.isArray(assessmentTypeIds))) {
        sendResponse(res, 400, false, "At least one field is required")
        return
    }

    try {
        const setup = await AssessmentSetup.findById(id)
        if (!setup) {
            sendResponse(res, 404, false, "Assessment setup not found")
            return
        }

        // Validate name uniqueness
        if (name && name.trim() !== setup.name) {
            const existingSetup = await AssessmentSetup.findOne({ name: name.trim() })
            if (existingSetup) {
                sendResponse(res, 400, false, "Assessment setup name already exists")
                return
            }
        }

        // Validate assessmentTypeIds if provided
        if (assessmentTypeIds && Array.isArray(assessmentTypeIds)) {
            if (assessmentTypeIds.length === 0) {
                sendResponse(res, 400, false, "At least one assessment type required")
                return
            }

            const validTypes = await AssessmentType.find({ _id: { $in: assessmentTypeIds } })
            if (validTypes.length !== assessmentTypeIds.length) {
                sendResponse(res, 400, false, "One or more assessment types not found")
                return
            }

            const totalWeight = validTypes.reduce((sum, type) => sum + type.weight, 0)
            if (totalWeight !== 100) {
                sendResponse(res, 400, false, `Total weight must equal 100%. Current: ${totalWeight}%`, {
                    types: validTypes.map(t => ({ name: t.name, weight: t.weight }))
                })
                return
            }

            setup.assessmentTypeIds = assessmentTypeIds
        }

        setup.name = name ? name.trim() : setup.name
        setup.description = description || setup.description
        await setup.save()

        const populatedSetup = await AssessmentSetup.findById(id)
            .populate('assessmentTypeIds', 'name weight description')

        sendResponse(res, 200, true, "Assessment setup updated successfully", {
            setup: populatedSetup,
            totalWeight: "100%"
        })
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const deleteAssessmentSetup = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id) {
    sendResponse(res, 400, false, "Missing required field: id");
    return;
  }

  try {
    const usedInScore = await AssessmentScore.findOne({ assessmentSetupId: id });
    const usedInGSA = await GradeSubjectAssessment.findOne({ assessmentSetupId: id });

    if (usedInScore || usedInGSA) {
      const usedPlaces: string[] = [];
      if (usedInScore) usedPlaces.push("Assessment Scores");
      if (usedInGSA) usedPlaces.push("Grade Subject Assessment");

      sendResponse(res, 400, false, `Cannot delete assessment setup because it is referenced in: ${usedPlaces.join(", ")}. Please delete or update the referenced records before removing this assessment setup.`, {
        references: {
          assessmentScoreId: usedInScore?._id || null,
          gradeSubjectAssessmentId: usedInGSA?._id || null,
        }
      });
      return;
    }

    const deletedSetup = await AssessmentSetup.findByIdAndDelete(id);
    if (!deletedSetup) {
      sendResponse(res, 404, false, "Assessment setup not found");
      return;
    }

    sendResponse(res, 200, true, "Assessment setup deleted successfully");
  } catch (error) {
    sendResponse(res, 500, false, "Internal server error", null, error);
  }
};