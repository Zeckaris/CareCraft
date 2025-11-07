import { Request, Response } from "express"
import { Subject } from "../../models/subject.model.ts"
import { sendResponse } from "../../utils/sendResponse.util.ts"

export const createSubject = async (req: Request, res: Response): Promise<void> => {
    const { name, description } = req.body
    if (!name) {
        sendResponse(res, 400, false, "Missing required field: name")
        return
    }
    try {
        const existingSubject = await Subject.findOne({ name: name.trim() })
        if (existingSubject) {
            sendResponse(res, 400, false, "Subject already exists")
            return
        }

        const newSubject = new Subject({ name: name.trim(), description })
        await newSubject.save()
        sendResponse(res, 201, true, "Subject created successfully", newSubject)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
        return;
    }
}

export const getAllSubjects = async (req: Request, res: Response): Promise<void> => {
    try {
        const subjects = await Subject.find().sort({ createdAt: -1 })
        sendResponse(res, 200, true, "Subjects fetched successfully", subjects)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
    }
}

export const getSubjectById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    if (!id) {
        sendResponse(res, 400, false, "Missing required field: id")
        return
    }

    try {
        const subject = await Subject.findById(id)
        if (!subject) {
            sendResponse(res, 404, false, "Subject not found")
            return
        }
        sendResponse(res, 200, true, "Subject fetched successfully", subject)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
        return;
    }
}

export const updateSubject = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { name, description } = req.body
    if (!id) {
        sendResponse(res, 400, false, "Missing required field: id")
        return
    }
    if (!name && !description) {
        sendResponse(res, 400, false, "At least one field (name or description) is required")
        return
    }

    try {
        const subject = await Subject.findById(id)
        if (!subject) {
            sendResponse(res, 404, false, "Subject not found")
            return
        }

        // Check if new name already exists (case-insensitive)
        if (name && name.trim() !== subject.name) {
            const existingSubject = await Subject.findOne({ name: name.trim() })
            if (existingSubject) {
                sendResponse(res, 400, false, "Subject name already exists")
                return
            }
        }

        subject.name = name ? name.trim() : subject.name
        subject.description = description || subject.description
        await subject.save()

        sendResponse(res, 200, true, "Subject updated successfully", subject)
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
        return;
    }
}

export const deleteSubject = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    if (!id) {
        sendResponse(res, 400, false, "Missing required field: id")
        return
    }

    try {
        const subject = await Subject.findByIdAndDelete(id)
        if (!subject) {
            sendResponse(res, 404, false, "Subject not found")
            return
        }
        sendResponse(res, 200, true, "Subject deleted successfully")
    } catch (error) {
        sendResponse(res, 500, false, "Internal server error", null, error)
        return;
    }
}