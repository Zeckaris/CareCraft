import { Request, Response } from 'express';
import { Student } from '../../models/student.model.js';
import { parseAndCleanStudentExcel } from '../../utils/parseAndCleanStudentExcel.utility.js';
import multer from 'multer';
import { extname } from 'path';
import { sendResponse } from '../../utils/sendResponse.util.js'; 

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedExts = ['.xlsx', '.xls'];
    const ext = extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .xlsx and .xls files are allowed.') as any, false);
    }
  },
}).single('file');

export const batchCreateStudents = async (req: Request, res: Response): Promise<void> => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      sendResponse(res, 400, false, `Upload error: ${err.message}`)
      return;
    } else if (err) {
      sendResponse(res, 400, false, err.message)
      return;
    }

    if (!req.file) {
      sendResponse(res, 400, false, 'No file uploaded.')
      return;
    }

    try {
      const { validStudents, errors, warnings } = await parseAndCleanStudentExcel(req.file.buffer, Student);

      if (validStudents.length === 0 && errors.length > 0) {
        sendResponse(res, 400, false, 'No valid students to process.', {
          successful: 0,
          failed: errors.length,
          errors,
          warnings,
          students: [],
        })
        return;
      }

      const insertedStudents = await Student.insertMany(validStudents, { ordered: false });

      sendResponse(res, 201, true, 'Batch creation completed.', {
        successful: insertedStudents.length,
        failed: errors.length,
        errors,
        warnings,
        students: insertedStudents.map((student) => ({ _id: student._id })),
      })
    } catch (error) {
      sendResponse(res, 500, false, 'Error processing batch creation.', null, error)
    }
  });
};