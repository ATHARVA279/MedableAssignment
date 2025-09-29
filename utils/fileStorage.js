const config = require('../config');
const { logger } = require('./logger');

// Import storage implementations
const cloudinaryStorage = require('./cloudinaryStorage');

/**
 * Save file using configured storage provider
 */
async function saveFile(fileBuffer, originalName, mimetype, options = {}) {
  try {
    if (config.storage.type === 'cloudinary') {
      return await cloudinaryStorage.uploadToCloudinary(fileBuffer, originalName, mimetype, options);
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error('File save failed', {
      error: error.message,
      originalName,
      mimetype,
      storageType: config.storage.type
    });
    throw error;
  }
}

/**
 * Delete file using configured storage provider
 */
async function deleteFile(fileIdentifier, resourceType = 'auto') {
  try {
    if (config.storage.type === 'cloudinary') {
      // For Cloudinary, fileIdentifier is the publicId
      return await cloudinaryStorage.deleteFromCloudinary(fileIdentifier, resourceType);
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error('File deletion failed', {
      error: error.message,
      fileIdentifier,
      storageType: config.storage.type
    });
    throw error;
  }
}

/**
 * Check if file exists using configured storage provider
 */
async function fileExists(fileIdentifier, resourceType = 'auto') {
  try {
    if (config.storage.type === 'cloudinary') {
      // For Cloudinary, try to get metadata to check existence
      await cloudinaryStorage.getFileMetadata(fileIdentifier, resourceType);
      return true;
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    return false;
  }
}

/**
 * Get file metadata using configured storage provider
 */
async function getFileStats(fileIdentifier, resourceType = 'auto') {
  try {
    if (config.storage.type === 'cloudinary') {
      return await cloudinaryStorage.getFileMetadata(fileIdentifier, resourceType);
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error('Failed to get file stats', {
      error: error.message,
      fileIdentifier,
      storageType: config.storage.type
    });
    throw error;
  }
}

/**
 * Generate thumbnail URL
 */
function generateThumbnailUrl(fileIdentifier, options = {}) {
  if (config.storage.type === 'cloudinary') {
    return cloudinaryStorage.generateThumbnailUrl(fileIdentifier, options);
  } else {
    throw new Error(`Thumbnail generation not supported for storage type: ${config.storage.type}`);
  }
}

/**
 * Generate optimized file URL
 */
function generateOptimizedUrl(fileIdentifier, resourceType = 'auto', options = {}) {
  if (config.storage.type === 'cloudinary') {
    return cloudinaryStorage.generateOptimizedUrl(fileIdentifier, resourceType, options);
  } else {
    throw new Error(`URL optimization not supported for storage type: ${config.storage.type}`);
  }
}

/**
 * Test storage connection
 */
async function testStorageConnection() {
  try {
    if (config.storage.type === 'cloudinary') {
      return await cloudinaryStorage.testCloudinaryConnection();
    } else {
      throw new Error(`Storage connection test not implemented for: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error('Storage connection test failed', {
      error: error.message,
      storageType: config.storage.type
    });
    return false;
  }
}

/**
 * Clean up old files (implementation depends on storage type)
 */
async function cleanupOldFiles() {
  try {
    logger.info('Cleanup operation called', { storageType: config.storage.type });
    
    if (config.storage.type === 'cloudinary') {
      // For Cloudinary, cleanup would typically be handled by their auto-cleanup features
      // or through their API for bulk operations
      logger.info('Cloudinary cleanup: Using Cloudinary auto-cleanup features');
      return true;
    } else {
      logger.warn('Cleanup not implemented for storage type', { storageType: config.storage.type });
      return false;
    }
  } catch (error) {
    logger.error('Cleanup operation failed', {
      error: error.message,
      storageType: config.storage.type
    });
    return false;
  }
}

/**
 * Initialize storage system
 */
async function initializeStorage() {
  try {
    logger.info('Initializing storage system', { storageType: config.storage.type });
    
    if (config.storage.type === 'cloudinary') {
      const isConfigured = cloudinaryStorage.isCloudinaryConfigured();
      if (!isConfigured) {
        throw new Error('Cloudinary credentials not configured');
      }
      
      const connectionTest = await cloudinaryStorage.testCloudinaryConnection();
      if (!connectionTest) {
        throw new Error('Cloudinary connection test failed');
      }
      
      logger.info('Cloudinary storage initialized successfully');
      return true;
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error('Storage initialization failed', {
      error: error.message,
      storageType: config.storage.type
    });
    throw error;
  }
}

module.exports = {
  saveFile,
  deleteFile,
  fileExists,
  getFileStats,
  generateThumbnailUrl,
  generateOptimizedUrl,
  testStorageConnection,
  cleanupOldFiles,
  initializeStorage
};