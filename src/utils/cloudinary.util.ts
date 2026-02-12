import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true, // always use https
});


/**
 * Uploads a buffer to Cloudinary (supports images, videos, raw files like PDF/Excel/etc)
 * @param buffer - File buffer from multer (memory storage)
 * @param folder - Cloudinary folder path (e.g. 'icons/badges', 'avatars', 'documents/students')
 * @param publicId - Optional custom public ID (without extension)
 * @param resourceType - 'image' | 'video' | 'raw' | 'auto'  (default: 'auto')
 * @param options - Extra Cloudinary upload options (e.g. { tags: ['student-doc'] })
 * @returns { url: string, publicId: string, resourceType: string } or throws
 */
export const uploadToCloudinary = async (
  buffer: Buffer,
  folder: string,
  publicId?: string,
  resourceType: 'image' | 'video' | 'raw' | 'auto' = 'auto',
  options: Record<string, any> = {}
): Promise<{ url: string; publicId: string; resourceType: string }> => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      public_id: publicId,
      resource_type: resourceType,
      ...options,  // allow overrides like allowed_formats, tags, etc.
    };

    // For images only: add optimization params (safe to skip for raw/video)
    if (resourceType === 'image' || resourceType === 'auto') {
      Object.assign(uploadOptions, {
        quality: 'auto',
        fetch_format: 'auto',
        width: 1024,     // max dimension – adjust as needed
        height: 1024,
        crop: 'limit',
      });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', error);
          return reject(error);
        }
        if (!result) {
          return reject(new Error('No result from Cloudinary upload'));
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          resourceType: result.resource_type,
        });
      }
    );

    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

/**
 * Deletes an image (or any resource) from Cloudinary by its public_id
 * @param publicId - The public_id returned from upload (e.g. 'icons/badges/icon-1234567890')
 */
export const deleteFromCloudinary = async (publicId: string): Promise<void> => {
  try {
    await new Promise<void>((resolve, reject) => {
      cloudinary.uploader.destroy(
        publicId,
        { resource_type: 'image' },
        (error) => {
          if (error) return reject(error);
          resolve();
        }
      );
    });
    console.log(`Deleted from Cloudinary: ${publicId}`);
  } catch (err) {
    console.warn(`Failed to delete ${publicId} from Cloudinary:`, err);
  }
};