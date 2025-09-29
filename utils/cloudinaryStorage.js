const cloudinary = require('cloudinary').v2;
const config = require('../config');
const { logger } = require('./logger');
const { retryOperations } = require('./retryManager');
const { RetryableError, PermanentError } = require('../middleware/errorHandler');
const { FileCompressor } = require('./fileCompression');

cloudinary.config({
  cloud_name: config.storage.cloudinary.cloudName,
  api_key: config.storage.cloudinary.apiKey,
  api_secret: config.storage.cloudinary.apiSecret,
  secure: config.storage.cloudinary.secure
});

async function uploadToCloudinary(fileBuffer, originalName, mimetype, options = {}) {
  const context = {
    operationName: 'Cloudinary Upload',
    originalName,
    mimetype,
    bufferSize: fileBuffer?.length
  };

  return retryOperations.fileUpload(async () => {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      throw new PermanentError('Invalid file buffer provided');
    }
    
    if (fileBuffer.length === 0) {
      throw new PermanentError('Empty file buffer');
    }
    
    if (!originalName || typeof originalName !== 'string') {
      throw new PermanentError('Invalid original filename provided');
    }
    
    if (!mimetype || typeof mimetype !== 'string') {
      throw new PermanentError('Invalid MIME type provided');
    }

    let uploadBuffer = fileBuffer;
    let uploadMimetype = mimetype;
    let compressionInfo = null;

    if (options.enableCompression !== false && FileCompressor.isCompressionSupported(mimetype)) {
      try {
        logger.debug('Applying compression before upload', { originalName, mimetype });
        
        const compressionResult = await FileCompressor.compressFile(
          fileBuffer, 
          originalName, 
          mimetype, 
          options.compressionOptions || {}
        );

        if (compressionResult.compressed) {
          uploadBuffer = compressionResult.buffer;
          uploadMimetype = compressionResult.format;
          compressionInfo = {
            originalSize: compressionResult.originalSize,
            compressedSize: compressionResult.compressedSize,
            compressionRatio: compressionResult.compressionRatio,
            sizeSaved: compressionResult.sizeSaved
          };

          logger.info('File compressed before upload', {
            originalName,
            ...compressionInfo
          });
        }
      } catch (compressionError) {
        logger.warn('Compression failed, uploading original file', {
          originalName,
          error: compressionError.message
        });
      }
    }

    let resourceType = 'auto';
    if (mimetype.startsWith('image/')) {
      resourceType = 'image';
    } else if (mimetype.startsWith('video/')) {
      resourceType = 'video';
    } else {
      resourceType = 'raw';
    }

    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExtension = originalName.split('.').pop();
    const publicId = `file-processing/${timestamp}-${randomString}`;

    const uploadOptions = {
      resource_type: resourceType,
      public_id: publicId,
      original_filename: originalName,
      use_filename: false,
      unique_filename: true,
      overwrite: false,
      ...options
    };

    if (resourceType === 'image') {
      uploadOptions.transformation = [
        { quality: 'auto' }
      ];
    }

    logger.info('Starting Cloudinary upload', {
      originalName,
      mimetype: uploadMimetype,
      resourceType,
      bufferSize: uploadBuffer.length,
      publicId,
      compressed: !!compressionInfo
    });

    const result = await new Promise((resolve, reject) => {
      try {
        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              logger.error('Cloudinary upload stream error', {
                error: error.message,
                errorCode: error.http_code,
                errorDetails: error,
                originalName,
                mimetype: uploadMimetype,
                resourceType,
                bufferSize: uploadBuffer.length
              });

              if (error.http_code >= 500 || error.message.includes('timeout') || 
                  error.message.includes('network') || error.message.includes('connection')) {
                reject(new RetryableError(`Cloudinary upload failed: ${error.message}`));
              } else if (error.http_code === 413 || error.message.includes('too large')) {
                reject(new PermanentError(`File too large for upload: ${error.message}`));
              } else if (error.http_code === 400 || error.message.includes('invalid')) {
                reject(new PermanentError(`Invalid upload request: ${error.message}`));
              } else {
                reject(new RetryableError(`Cloudinary upload failed: ${error.message}`));
              }
            } else if (!result) {
              logger.error('Cloudinary upload returned no result', {
                originalName,
                mimetype: uploadMimetype,
                resourceType
              });
              reject(new RetryableError('Cloudinary upload returned no result'));
            } else {
              logger.info('Cloudinary upload successful', {
                publicId: result.public_id,
                originalName,
                size: result.bytes,
                compressed: !!compressionInfo
              });
              resolve(result);
            }
          }
        );
        
        uploadStream.on('error', (streamError) => {
          logger.error('Cloudinary upload stream error', {
            error: streamError.message,
            originalName,
            mimetype: uploadMimetype
          });
          reject(new RetryableError(`Upload stream failed: ${streamError.message}`));
        });
        
        uploadStream.end(uploadBuffer);
        
      } catch (promiseError) {
        logger.error('Promise setup error in Cloudinary upload', {
          error: promiseError.message,
          originalName,
          mimetype: uploadMimetype
        });
        reject(new RetryableError(`Upload setup failed: ${promiseError.message}`));
      }
    });

    logger.info('File uploaded to Cloudinary', {
      publicId: result.public_id,
      originalName,
      size: result.bytes,
      format: result.format,
      resourceType: result.resource_type
    });

    const uploadResult = {
      publicId: result.public_id,
      secureUrl: result.secure_url,
      url: result.url,
      size: result.bytes,
      format: result.format,
      resourceType: result.resource_type,
      width: result.width,
      height: result.height,
      originalName,
      mimetype: uploadMimetype,
      originalMimetype: mimetype,
      createdAt: result.created_at,
      buffer: uploadBuffer 
    };

    if (compressionInfo) {
      uploadResult.compression = compressionInfo;
    }

    return uploadResult;

  }, context);
}

async function deleteFromCloudinary(publicId, resourceType = 'auto') {
  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });

    logger.info('File deleted from Cloudinary', {
      publicId,
      result: result.result
    });

    return result.result === 'ok';
  } catch (error) {
    logger.error('Cloudinary deletion failed', {
      error: error.message,
      publicId
    });
    throw new Error(`Failed to delete file from Cloudinary: ${error.message}`);
  }
}

function generateThumbnailUrl(publicId, options = {}) {
  const defaultOptions = {
    width: 200,
    height: 200,
    crop: 'fill',
    quality: 'auto',
    format: 'auto'
  };

  const transformOptions = { ...defaultOptions, ...options };

  return cloudinary.url(publicId, {
    resource_type: 'image',
    transformation: [transformOptions]
  });
}

function generateOptimizedUrl(publicId, resourceType = 'auto', options = {}) {
  const baseOptions = {
    secure: true,
    ...options
  };

  if (resourceType === 'image') {
    baseOptions.quality = baseOptions.quality || 'auto';
    baseOptions.fetch_format = baseOptions.fetch_format || 'auto';
  }

  return cloudinary.url(publicId, {
    resource_type: resourceType,
    ...baseOptions
  });
}

function generateDownloadUrl(publicId, resourceType = 'raw', filename = null) {
  const options = {
    resource_type: resourceType,
    flags: 'attachment',
    secure: true
  };

  if (filename) {
    const cleanFilename = filename.split('/').pop();
    options.public_id = `${publicId}/${cleanFilename}`;
  }

  return cloudinary.url(publicId, options);
}

function extractPublicIdFromUrl(cloudinaryUrl) {
  try {
    const urlParts = cloudinaryUrl.split('/');
    const uploadIndex = urlParts.findIndex(part => part === 'upload');
    
    if (uploadIndex === -1) {
      throw new Error('Invalid Cloudinary URL format');
    }
    
    let pathParts = urlParts.slice(uploadIndex + 1);
    
    if (pathParts[0] && pathParts[0].match(/^v\d+$/)) {
      pathParts = pathParts.slice(1);
    }
    
    const publicIdWithExtension = pathParts.join('/');
    const publicId = publicIdWithExtension.replace(/\.[^/.]+$/, '');
    
    return publicId;
  } catch (error) {
    logger.error('Failed to extract public ID from URL', {
      url: cloudinaryUrl,
      error: error.message
    });
    throw new Error(`Failed to extract public ID: ${error.message}`);
  }
}

async function getFileMetadata(publicId, resourceType = 'auto') {
  try {
    const result = await cloudinary.api.resource(publicId, {
      resource_type: resourceType
    });

    return {
      publicId: result.public_id,
      format: result.format,
      size: result.bytes,
      width: result.width,
      height: result.height,
      createdAt: result.created_at,
      secureUrl: result.secure_url,
      resourceType: result.resource_type
    };
  } catch (error) {
    logger.error('Failed to get Cloudinary metadata', {
      error: error.message,
      publicId
    });
    throw new Error(`Failed to get file metadata: ${error.message}`);
  }
}

function isCloudinaryConfigured() {
  return !!(
    config.storage.cloudinary.cloudName &&
    config.storage.cloudinary.apiKey &&
    config.storage.cloudinary.apiSecret
  );
}

async function testCloudinaryConnection() {
  try {
    if (!isCloudinaryConfigured()) {
      throw new Error('Cloudinary credentials not configured');
    }

    const result = await cloudinary.api.ping();
    
    logger.info('Cloudinary connection test successful', { status: result.status });
    return { success: true, status: result.status };
  } catch (error) {
    logger.error('Cloudinary connection test failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  generateThumbnailUrl,
  generateOptimizedUrl,
  generateDownloadUrl,
  extractPublicIdFromUrl,
  getFileMetadata,
  isCloudinaryConfigured,
  testCloudinaryConnection,
  testCloudinaryUpload,
  cloudinary
};