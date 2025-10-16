import { Request, Response } from "express";
import { SchoolInfo } from "../models/schoolInfo.model";


export const createSchoolInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const existing = await SchoolInfo.findOne();
    if (existing) {
      res.status(400).json({ message: "School info already exists. Please update instead." });
      return;
    }

    const schoolInfo = new SchoolInfo(req.body);
    await schoolInfo.save();

    res.status(201).json({ message: "School info created successfully", data: schoolInfo });
  } catch (error) {
    console.error("Error creating school info:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};


export const getSchoolInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolInfo = await SchoolInfo.findOne();
    if (!schoolInfo) {
      res.status(404).json({ message: "School info not found" });
      return;
    }

    res.status(200).json({ data: schoolInfo });
  } catch (error) {
    console.error("Error fetching school info:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};


export const updateSchoolInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolInfo = await SchoolInfo.findOne();
    if (!schoolInfo) {
      res.status(404).json({ message: "School info not found. Please create one first." });
      return;
    }

    const updatedInfo = await SchoolInfo.findByIdAndUpdate(schoolInfo._id, req.body, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({ message: "School info updated successfully", data: updatedInfo });
  } catch (error) {
    console.error("Error updating school info:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};

// Incase
export const deleteSchoolInfo = async (req: Request, res: Response): Promise<void> => {
  try {
    const schoolInfo = await SchoolInfo.findOne();
    if (!schoolInfo) {
      res.status(404).json({ message: "School info not found" });
      return;
    }

    await SchoolInfo.findByIdAndDelete(schoolInfo._id);
    res.status(200).json({ message: "School info deleted successfully" });
  } catch (error) {
    console.error("Error deleting school info:", error);
    res.status(500).json({ message: "Internal server error", error });
  }
};
