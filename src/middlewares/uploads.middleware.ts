import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const createUpload = (folderPath: string) => {
  const fullPath = path.join(__dirname, '..', '..', 'uploads', folderPath);

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
      // List of folders that should accept images
      const imageFolders = [
        'icons/badges',
        'logos',              // e.g. school logo
        'avatars',
        'images',             // fallback for any folder with "image"
        'icons',
      ];

      const isImageFolder = imageFolders.some(folder => 
        folderPath.includes(folder) || folderPath.includes('image')
      );

      if (isImageFolder) {
        const allowedImageTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/svg+xml',
        ];
        if (allowedImageTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Invalid image type for ${folderPath}. Allowed: JPEG, PNG, GIF, WebP, SVG`));
        }
      } else {
        // Non-image folders (e.g. documents)
        const allowedDocTypes = /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument)/;
        if (allowedDocTypes.test(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Invalid file type for ${folderPath}`));
        }
      }
    },
  });
};