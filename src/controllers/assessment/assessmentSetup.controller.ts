import { Request, Response } from "express"
import { AssessmentSetup } from "../../models/assessment/assessmentSetup.model"
import { AssessmentType } from "../../models/assessment/assessmentType.model"
import { AssessmentScore } from "../../models/assessment/assessmentScore.model"
import { GradeSubjectAssessment } from "../../models/gradeSubjectAssessment.model"

export const createAssessmentSetup = async (req: Request, res: Response): Promise<void> => {
    const { name, description, assessmentTypeIds } = req.body
    if (!name || !assessmentTypeIds || !Array.isArray(assessmentTypeIds)) {
        res.status(400).json({ message: "Missing required fields: name, assessmentTypeIds (array)" })
        return
    }
    if (assessmentTypeIds.length === 0) {
        res.status(400).json({ message: "At least one assessment type required" })
        return
    }

    try {
        const existingSetup = await AssessmentSetup.findOne({ name: name.trim() })
        if (existingSetup) {
            res.status(400).json({ message: "Assessment setup already exists" })
            return
        }
        const validTypes = await AssessmentType.find({ _id: { $in: assessmentTypeIds } })
        if (validTypes.length !== assessmentTypeIds.length) {
            res.status(400).json({ message: "One or more assessment types not found" })
            return
        }

        const totalWeight = validTypes.reduce((sum, type) => sum + type.weight, 0)
        if (totalWeight !== 100) {
            res.status(400).json({ 
                message: `Total weight must equal 100%. Current: ${totalWeight}%`,
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
        res.status(201).json({ 
            message: "Assessment setup created successfully", 
            data: newSetup,
            totalWeight: `${totalWeight}%`
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getAllAssessmentSetups = async (req: Request, res: Response): Promise<void> => {
    try {
        const setups = await AssessmentSetup.find()
            .populate('assessmentTypeIds', 'name weight description')
            .sort({ createdAt: -1 })
        res.status(200).json({ setups })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getAssessmentSetupById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    if (!id) {
        res.status(400).json({ message: "Missing required field: id" })
        return
    }

    try {
        const setup = await AssessmentSetup.findById(id)
            .populate('assessmentTypeIds', 'name weight description')
        if (!setup) {
            res.status(404).json({ message: "Assessment setup not found" })
            return
        }
        res.status(200).json({ setup })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const updateAssessmentSetup = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { name, description, assessmentTypeIds } = req.body
    if (!id) {
        res.status(400).json({ message: "Missing required field: id" })
        return
    }
    if (!name && !description && (!assessmentTypeIds || !Array.isArray(assessmentTypeIds))) {
        res.status(400).json({ message: "At least one field is required" })
        return
    }

    try {
        const setup = await AssessmentSetup.findById(id)
        if (!setup) {
            res.status(404).json({ message: "Assessment setup not found" })
            return
        }

        // Validate name uniqueness
        if (name && name.trim() !== setup.name) {
            const existingSetup = await AssessmentSetup.findOne({ name: name.trim() })
            if (existingSetup) {
                res.status(400).json({ message: "Assessment setup name already exists" })
                return
            }
        }

        // Validate assessmentTypeIds if provided
        if (assessmentTypeIds && Array.isArray(assessmentTypeIds)) {
            if (assessmentTypeIds.length === 0) {
                res.status(400).json({ message: "At least one assessment type required" })
                return
            }

            const validTypes = await AssessmentType.find({ _id: { $in: assessmentTypeIds } })
            if (validTypes.length !== assessmentTypeIds.length) {
                res.status(400).json({ message: "One or more assessment types not found" })
                return
            }

            const totalWeight = validTypes.reduce((sum, type) => sum + type.weight, 0)
            if (totalWeight !== 100) {
                res.status(400).json({ 
                    message: `Total weight must equal 100%. Current: ${totalWeight}%`,
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

        res.status(200).json({ 
            message: "Assessment setup updated successfully", 
            data: populatedSetup,
            totalWeight: "100%"
        })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const deleteAssessmentSetup = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ message: "Missing required field: id" });
    return;
  }

  try {
    const usedInScore = await AssessmentScore.findOne({ assessmentSetupId: id });
    const usedInGSA = await GradeSubjectAssessment.findOne({ assessmentSetupId: id });

    if (usedInScore || usedInGSA) {
      const usedPlaces: string[] = [];
      if (usedInScore) usedPlaces.push("Assessment Scores");
      if (usedInGSA) usedPlaces.push("Grade Subject Assessment");

      res.status(400).json({
        message: `Cannot delete assessment setup because it is referenced in: ${usedPlaces.join(", ")}.`,
        action: "Please delete or update the referenced records before removing this assessment setup.",
        references: {
          assessmentScoreId: usedInScore?._id || null,
          gradeSubjectAssessmentId: usedInGSA?._id || null,
        },
      });
      return;
    }

    const deletedSetup = await AssessmentSetup.findByIdAndDelete(id);
    if (!deletedSetup) {
      res.status(404).json({ message: "Assessment setup not found" });
      return;
    }

    res.status(200).json({ message: "Assessment setup deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Internal server error", error });
  }
};