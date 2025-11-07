import XLSX from 'xlsx';
import { IStudent } from '../types/student.type.ts';
import { Model } from 'mongoose';

// Interface for the result of parsing
interface ExcelParseResult {
  validStudents: Partial<IStudent>[];
  errors: { row: number; message: string }[];
  warnings: { row: number; message: string }[];
}

// Utility function to parse and clean Excel data
export const parseAndCleanStudentExcel = async (
  fileBuffer: Buffer,
  StudentModel: Model<IStudent>
): Promise<ExcelParseResult> => {
  // Initialize result
  const result: ExcelParseResult = { validStudents: [], errors: [], warnings: [] };

  try {
    // Read Excel file from buffer
    const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert sheet to JSON, using first row as headers
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' }) as any[][];

    if (rows.length < 2) {
      result.errors.push({ row: 1, message: 'Excel file is empty or has no data rows' });
      return result;
    }

    // Extract headers (case-insensitive mapping)
    const headers = rows[0].map((header: string) => header.toLowerCase().trim());
    const allowedFields = ['firstName', 'lastName', 'middleName', 'gender', 'dateOfBirth', 'profileImage'];
    const fieldMap = headers.reduce((map, header, index) => {
      const normalized = allowedFields.find(field => field.toLowerCase() === header.toLowerCase());
      if (normalized) map[normalized] = index;
      return map;
    }, {} as Record<string, number>);

    // Validate required headers
    const requiredFields = ['firstName', 'lastName', 'gender', 'dateOfBirth'];
    const missingFields = requiredFields.filter(field => !(field in fieldMap));
    if (missingFields.length > 0) {
      result.errors.push({
        row: 1,
        message: `Missing required columns: ${missingFields.join(', ')}`,
      });
      return result;
    }

    // Prepare for duplicate check
    const potentialDuplicates: { key: string; row: number }[] = [];
    const studentKeys = new Set<string>();

    // Process data rows (skip header)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1; // Excel rows are 1-based for user-facing errors

      // Build student object
      const student: Partial<IStudent> = {};

      // Map fields
      if (fieldMap.firstName !== undefined) {
        const value = row[fieldMap.firstName]?.toString().trim();
        if (!value) {
          result.errors.push({ row: rowNum, message: 'Missing required field: firstName' });
          continue;
        }
        student.firstName = value;
      }

      if (fieldMap.lastName !== undefined) {
        const value = row[fieldMap.lastName]?.toString().trim();
        if (!value) {
          result.errors.push({ row: rowNum, message: 'Missing required field: lastName' });
          continue;
        }
        student.lastName = value;
      }

      if (fieldMap.gender !== undefined) {
        const value = row[fieldMap.gender]?.toString().trim();
        if (!value) {
          result.errors.push({ row: rowNum, message: 'Missing required field: gender' });
          continue;
        }
        const gender = value.charAt(0).toUpperCase();
        if (gender !== 'M' && gender !== 'F') {
          result.errors.push({
            row: rowNum,
            message: `Invalid gender: '${value}'. Must be 'Male' or 'Female' (case-insensitive)`,
          });
          continue;
        }
        student.gender = gender;
      }

      if (fieldMap.dateOfBirth !== undefined) {
        const value = row[fieldMap.dateOfBirth];
        let dob: Date;
        try {
          dob = new Date(value);
          if (isNaN(dob.getTime())) {
            result.errors.push({ row: rowNum, message: 'Invalid dateOfBirth format' });
            continue;
          }
          student.dateOfBirth = dob;
        } catch {
          result.errors.push({ row: rowNum, message: 'Invalid dateOfBirth format' });
          continue;
        }
      }

      // Optional fields with defaults
      student.middleName = fieldMap.middleName !== undefined ? row[fieldMap.middleName]?.toString().trim() || '' : '';
      student.profileImage = fieldMap.profileImage !== undefined ? row[fieldMap.profileImage]?.toString().trim() || '' : '';
      student.admissionDate = new Date();
      student.parentId = null;
      student.enrollmentId = null;

      // Generate duplicate check key
      const dupeKey = `${student.firstName}_${student.lastName}_${student.dateOfBirth?.toISOString()}`;
      potentialDuplicates.push({ key: dupeKey, row: rowNum });
      studentKeys.add(dupeKey);

      // Add to valid students
      result.validStudents.push(student);
    }

    // Check for duplicates in DB
    if (result.validStudents.length > 0) {
      const existingStudents = await StudentModel.find({
        $or: Array.from(studentKeys).map(key => {
          const [firstName, lastName, dateOfBirth] = key.split('_');
          return { firstName, lastName, dateOfBirth: new Date(dateOfBirth) };
        }),
      }).select('_id firstName lastName dateOfBirth');

      const existingKeys = new Set(
        existingStudents.map(s => `${s.firstName}_${s.lastName}_${s.dateOfBirth.toISOString()}`)
      );

      for (const { key, row } of potentialDuplicates) {
        if (existingKeys.has(key)) {
          result.warnings.push({ row, message: 'Potential duplicate based on name and DOB' });
        }
      }
    }

    return result;
  } catch (error) {
    result.errors.push({ row: 0, message: `Failed to process Excel file: ${(error as Error).message}` });
    return result;
  }
};