import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const createUpload = (folderPath: string) => {
  const fullPath = path.join(__dirname, '..', 'uploads', folderPath);

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, fullPath);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      const isImage = folderPath.includes('image');
      const allowed = isImage
        ? /^image\//
        : /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument)/;

      if (allowed.test(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Invalid file type for ${folderPath}`));
      }
    },
  });
};