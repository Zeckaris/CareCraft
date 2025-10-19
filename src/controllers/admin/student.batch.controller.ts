import { Request, Response } from 'express';
import { Student } from '../../models/student.model';
import { parseAndCleanStudentExcel } from '../../utils/parseAndCleanStudentExcel.utility';
import multer from 'multer';
import { extname } from 'path';

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
      res.status(400).json({ message: `Upload error: ${err.message}` });
      return;
    } else if (err) {
      res.status(400).json({ message: err.message });
      return;
    }

    if (!req.file) {
      res.status(400).json({ message: 'No file uploaded.' });
      return;
    }

    try {
      const { validStudents, errors, warnings } = await parseAndCleanStudentExcel(req.file.buffer, Student);

      if (validStudents.length === 0 && errors.length > 0) {
        res.status(400).json({
          message: 'No valid students to process.',
          successful: 0,
          failed: errors.length,
          errors,
          warnings,
          students: [],
        });
        return;
      }

      const insertedStudents = await Student.insertMany(validStudents, { ordered: false });

      res.status(201).json({
        message: 'Batch creation completed.',
        successful: insertedStudents.length,
        failed: errors.length,
        errors,
        warnings,
        students: insertedStudents.map((student) => ({ _id: student._id })),
      });
    } catch (error) {
      res.status(500).json({
        message: 'Error processing batch creation.',
        error: (error as Error).message,
      });
    }
  });
};