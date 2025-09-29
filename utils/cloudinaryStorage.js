const cloudinary = require('cloudinary').v2;
const config = require('../config');
const { logger } = require('./logger');
const { retryOperations } = require('./retryManager');
const { RetryableError, PermanentError } = require('../middleware/errorHandler');
const { FileCompressor } = require('./fileCompression');

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.storage.cloudinary.cloudName,
  api_key: config.storage.cloudinary.apiKey,
  api_secret: config.storage.cloudinary.apiSecret,
  secure: config.storage.cloudinary.secure
});

/**
 * Upload file buffer to Cloudinary with retry logic and compression
 */
async function uploadToCloudinary(fileBuffer, originalName, mimetype, options = {}) {
  const context = {
    operationName: 'Cloudinary Upload',
    originalName,
    mimetype,
    bufferSize: fileBuffer?.length
  };

  return retryOperations.fileUpload(async () => {
    // Validate inputs
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

    // Apply compression if enabled and supported
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
        // Continue with original buffer if compression fails
      }
    }

    // Determine resource type based on MIME type
    let resourceType = 'auto';
    if (mimetype.startsWith('image/')) {
      resourceType = 'image';
    } else if (mimetype.startsWith('video/')) {
      resourceType = 'video';
    } else {
      resourceType = 'raw'; // For PDFs, CSVs, etc.
    }

    // Generate a unique public_id
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

    // For images, add transformation options but remove problematic ones
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

    // Upload to Cloudinary with improved error handling
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

              // Categorize errors for retry logic
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
        
        // Handle stream errors
        uploadStream.on('error', (streamError) => {
          logger.error('Cloudinary upload stream error', {
            error: streamError.message,
            originalName,
            mimetype: uploadMimetype
          });
          reject(new RetryableError(`Upload stream failed: ${streamError.message}`));
        });
        
        // End the stream with the buffer
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
      buffer: uploadBuffer // Include buffer for further processing
    };

    // Add compression information if compression was applied
    if (compressionInfo) {
      uploadResult.compression = compressionInfo;
    }

    return uploadResult;

  }, context); // Close the retry operation
}

/**
 * Delete file from Cloudinary
 */
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

/**
 * Generate thumbnail URL for images
 */
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

/**
 * Generate optimized URL for any file type
 */
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

/**
 * Get file metadata from Cloudinary
 */
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

/**
 * Check if Cloudinary is properly configured
 */
function isCloudinaryConfigured() {
  return !!(
    config.storage.cloudinary.cloudName &&
    config.storage.cloudinary.apiKey &&
    config.storage.cloudinary.apiSecret
  );
}

/**
 * Test Cloudinary connection
 */
async function testCloudinaryConnection() {
  try {
    if (!isCloudinaryConfigured()) {
      throw new Error('Cloudinary credentials not configured');
    }

    // Test by getting account details
    const result = await cloudinary.api.ping();
    
    logger.info('Cloudinary connection test successful', { status: result.status });
    return { success: true, status: result.status };
  } catch (error) {
    logger.error('Cloudinary connection test failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Test a simple upload to verify configuration
 */
async function testCloudinaryUpload() {
  try {
    if (!isCloudinaryConfigured()) {
      throw new Error('Cloudinary credentials not configured');
    }

    // Create a simple test buffer (1x1 white pixel PNG)
    const testBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
      0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x00,
      0x01, 0x00, 0x01, 0x5C, 0xC2, 0x8A, 0x83, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);

    const result = await uploadToCloudinary(testBuffer, 'test-connection.png', 'image/png');
    
    // Clean up test image
    try {
      await deleteFromCloudinary(result.publicId, 'image');
    } catch (cleanupError) {
      logger.warn('Failed to cleanup test image', { publicId: result.publicId });
    }
    
    logger.info('Cloudinary upload test successful');
    return { success: true, message: 'Upload test passed' };
  } catch (error) {
    logger.error('Cloudinary upload test failed', { error: error.message });
    return { success: false, error: error.message };
  }
}

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  generateThumbnailUrl,
  generateOptimizedUrl,
  getFileMetadata,
  isCloudinaryConfigured,
  testCloudinaryConnection,
  testCloudinaryUpload,
  cloudinary
};