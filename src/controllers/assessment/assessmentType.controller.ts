import { Request, Response } from "express"
import { AssessmentType } from "../../models/assessment/assessmentType.model"
import { GradeSubjectAssessment } from "../../models/gradeSubjectAssessment.model"
import { AssessmentSetup } from "../../models/assessment/assessmentSetup.model"

export const createAssessmentType = async (req: Request, res: Response): Promise<void> => {
    const { name, weight, description } = req.body
    if (!name || !weight) {
        res.status(400).json({ message: "Missing required fields: name, weight" })
        return
    }
    if (weight < 0 || weight > 100) {
        res.status(400).json({ message: "Weight must be between 0 and 100" })
        return
    }
    try {
        const existingType = await AssessmentType.findOne({ name: name.trim() })
        if (existingType) {
            res.status(400).json({ message: "Assessment type already exists" })
            return
        }

        const newType = new AssessmentType({ 
            name: name.trim(), 
            weight, 
            description 
        })
        await newType.save()
        res.status(201).json({ message: "Assessment type created successfully", data: newType })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getAllAssessmentTypes = async (req: Request, res: Response): Promise<void> => {
    try {
        const types = await AssessmentType.find().sort({ createdAt: -1 })
        res.status(200).json({ types })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getAssessmentTypeById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    if (!id) {
        res.status(400).json({ message: "Missing required field: id" })
        return
    }

    try {
        const type = await AssessmentType.findById(id)
        if (!type) {
            res.status(404).json({ message: "Assessment type not found" })
            return
        }
        res.status(200).json({ type })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const updateAssessmentType = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { name, weight, description } = req.body
    if (!id) {
        res.status(400).json({ message: "Missing required field: id" })
        return
    }
    if (!name && !weight && !description) {
        res.status(400).json({ message: "At least one field is required" })
        return
    }
    if (weight && (weight < 0 || weight > 100)) {
        res.status(400).json({ message: "Weight must be between 0 and 100" })
        return
    }

    try {
        const type = await AssessmentType.findById(id)
        if (!type) {
            res.status(404).json({ message: "Assessment type not found" })
            return
        }

        if (name && name.trim() !== type.name) {
            const existingType = await AssessmentType.findOne({ name: name.trim() })
            if (existingType) {
                res.status(400).json({ message: "Assessment type name already exists" })
                return
            }
        }

        type.name = name ? name.trim() : type.name
        type.weight = weight !== undefined ? weight : type.weight
        type.description = description || type.description
        await type.save()

        res.status(200).json({ message: "Assessment type updated successfully", data: type })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}


export const deleteAssessmentType = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  if (!id) {
    res.status(400).json({ message: "Missing required field: id" })
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

      res.status(400).json({
        message: `Cannot delete assessment type because it is referenced in: ${usedPlaces.join(", ")}.`,
        action: "Please delete or update the referenced setup(s) before removing this assessment type.",
        references: {
          setupId: usedInSetup?._id || null,
          gradeSubjectAssessmentId: usedInGSA?._id || null,
        },
      })
      return
    }

    const deletedType = await AssessmentType.findByIdAndDelete(id)
    if (!deletedType) {
      res.status(404).json({ message: "Assessment type not found" })
      return
    }

    res.status(200).json({ message: "Assessment type deleted successfully" })
  } catch (error) {
    res.status(500).json({ message: "Internal server error", error })
  }
}
