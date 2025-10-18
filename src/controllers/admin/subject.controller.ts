import { Request, Response } from "express"
import { Subject } from "../../models/subject.model"

export const createSubject = async (req: Request, res: Response): Promise<void> => {
    const { name, description } = req.body
    if (!name) {
        res.status(400).json({ message: "Missing required field: name" })
        return
    }
    try {
        const existingSubject = await Subject.findOne({ name: name.trim() })
        if (existingSubject) {
            res.status(400).json({ message: "Subject already exists" })
            return
        }

        const newSubject = new Subject({ name: name.trim(), description })
        await newSubject.save()
        res.status(201).json({ message: "Subject created successfully", data: newSubject })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getAllSubjects = async (req: Request, res: Response): Promise<void> => {
    try {
        const subjects = await Subject.find().sort({ createdAt: -1 })
        res.status(200).json({ subjects })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const getSubjectById = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    if (!id) {
        res.status(400).json({ message: "Missing required field: id" })
        return
    }

    try {
        const subject = await Subject.findById(id)
        if (!subject) {
            res.status(404).json({ message: "Subject not found" })
            return
        }
        res.status(200).json({ subject })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const updateSubject = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    const { name, description } = req.body
    if (!id) {
        res.status(400).json({ message: "Missing required field: id" })
        return
    }
    if (!name && !description) {
        res.status(400).json({ message: "At least one field (name or description) is required" })
        return
    }

    try {
        const subject = await Subject.findById(id)
        if (!subject) {
            res.status(404).json({ message: "Subject not found" })
            return
        }

        // Check if new name already exists (case-insensitive)
        if (name && name.trim() !== subject.name) {
            const existingSubject = await Subject.findOne({ name: name.trim() })
            if (existingSubject) {
                res.status(400).json({ message: "Subject name already exists" })
                return
            }
        }

        subject.name = name ? name.trim() : subject.name
        subject.description = description || subject.description
        await subject.save()

        res.status(200).json({ message: "Subject updated successfully", data: subject })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}

export const deleteSubject = async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params
    if (!id) {
        res.status(400).json({ message: "Missing required field: id" })
        return
    }

    try {
        const subject = await Subject.findByIdAndDelete(id)
        if (!subject) {
            res.status(404).json({ message: "Subject not found" })
            return
        }
        res.status(200).json({ message: "Subject deleted successfully" })
    } catch (error) {
        res.status(500).json({ message: "Internal server error", error })
    }
}