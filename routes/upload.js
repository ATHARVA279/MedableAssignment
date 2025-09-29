const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

// Import middleware and utilities
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { validateFile } = require('../middleware/fileValidation');
const { AppError, asyncHandler, asyncHandlerWithRetry, commonErrors } = require('../middleware/errorHandler');
const { saveFile, deleteFile, fileExists, generateThumbnailUrl } = require('../utils/fileStorage');
const { processFile, enhancedProcessingTracker } = require('../utils/enhancedFileProcessor');
const { encryptFileForStorage, isEncryptionEnabled } = require('../utils/fileEncryption');
const { initializeUserQuota, canUserUploadFile, recordFileUpload, recordFileDeletion } = require('../utils/storageQuotas');
const { createFileVersion } = require('../utils/fileVersioning');
const { accessLogger } = require('../utils/accessLogger');
const { memoryMonitor } = require('../utils/memoryMonitor');
const { networkTimeoutHandler } = require('../utils/networkTimeout');
const { inputSanitizer } = require('../utils/inputSanitizer');
const { retryOperations } = require('../utils/retryManager');
const { FileCompressor } = require('../utils/fileCompression');
const { queueManager, JOB_TYPES, JOB_PRIORITIES } = require('../utils/jobQueue');

// Import file service for MongoDB operations
const { fileService } = require('../services/fileService');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'text/csv'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(`File type ${file.mimetype} is not allowed`, 415));
    }
  }
});

/**
 * Check if user can access file
 */
function canAccessFile(file, user) {
  if (!file) return false;
  
  // Public files can be accessed by anyone
  if (file.publicAccess) return true;
  
  // File owner can always access (handle both old and new format)
  const fileOwnerId = file.uploadedBy || file.uploaderId;
  if (user && fileOwnerId === user.userId) return true;
  
  // Admin can access all files
  if (user && user.role === 'admin') return true;
  
  return false;
}

/**
 * Sanitize file data for response (remove sensitive info)
 */
function sanitizeFileData(file, user, includeProcessingResult = false) {
  const sanitized = {
    id: file.id,
    originalName: file.originalName,
    size: file.size,
    mimetype: file.mimetype,
    uploadDate: file.uploadDate,
    status: file.status,
    publicAccess: file.publicAccess
  };
  
  // Only include secure URL if file is accessible
  if (canAccessFile(file, user)) {
    sanitized.secureUrl = file.secureUrl;
    
    // Include thumbnail URL for images if available
    if (file.processingResult?.thumbnailUrl) {
      sanitized.thumbnailUrl = file.processingResult.thumbnailUrl;
    }
  }
  
  // Only show uploader info to owner or admin
  if (user && (file.uploadedBy === user.userId || user.role === 'admin')) {
    sanitized.uploadedBy = file.uploadedBy;
  }
  
  // Include processing result if requested and accessible
  if (includeProcessingResult && canAccessFile(file, user) && file.processingResult) {
    // Remove sensitive internal data from processing result
    const { publicId, ...sanitizedProcessingResult } = file.processingResult;
    sanitized.processingResult = sanitizedProcessingResult;
  }
  
  return sanitized;
}

// Get user files - REQUIRES AUTHENTICATION
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  // Sanitize query parameters
  const queryResult = inputSanitizer.sanitizeQueryParams(req.query);
  if (!queryResult.isValid) {
    throw commonErrors.badRequest(`Invalid query parameters: ${queryResult.errors.join(', ')}`);
  }
  
  const sanitizedQuery = queryResult.sanitized;
  const page = Math.max(1, parseInt(sanitizedQuery.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(sanitizedQuery.limit) || 20));
  const status = sanitizedQuery.status;
  const publicOnly = sanitizedQuery.public === 'true';
  const search = sanitizedQuery.search;

  // Log access
  await accessLogger.logFileAccess(null, req.user.userId, 'list', {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    query: sanitizedQuery
  });

  let result;
  
  if (publicOnly) {
    // Get public files only
    result = await fileService.getPublicFiles({
      page,
      limit,
      mimetype: sanitizedQuery.mimetype,
      search
    });
  } else {
    // Get user's files (or all files for admin)
    const uploaderId = req.user.role === 'admin' ? null : req.user.userId;
    
    if (search) {
      result = await fileService.searchFiles(search, uploaderId, { page, limit });
    } else {
      result = await fileService.getFilesByUploader(uploaderId || req.user.userId, {
        page,
        limit,
        status,
        mimetype: sanitizedQuery.mimetype,
        publicAccess: sanitizedQuery.publicAccess
      });
    }
  }

  // Get processing queue count
  const File = require('../models/File');
  const processingCount = await File.countDocuments({ status: 'processing' });

  // Set secure response headers
  res.set({
    'X-Total-Files': result.pagination.total.toString(),
    'X-Processing-Queue': processingCount.toString()
  });

  // Convert MongoDB files to the expected format
  const sanitizedFiles = result.files.map(file => ({
    id: file.fileId,
    originalName: file.originalName,
    size: file.size,
    mimetype: file.mimetype,
    uploadDate: file.createdAt,
    status: file.status,
    publicAccess: file.publicAccess,
    secureUrl: file.cloudinaryUrl,
    uploadedBy: (req.user.role === 'admin' || file.uploaderId === req.user.userId) ? file.uploaderId : undefined,
    thumbnailUrl: file.processingResult?.thumbnailUrl,
    processingResult: file.processingResult
  }));

  res.json({
    files: sanitizedFiles,
    pagination: result.pagination
  });
}));

// Get file info - REQUIRES AUTHENTICATION
router.get('/:fileId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  // Sanitize file ID
  const sanitizedFileId = inputSanitizer.sanitizeText(fileId, 50);
  if (!sanitizedFileId) {
    throw commonErrors.badRequest('Invalid file ID');
  }
  
  try {
    const file = await fileService.getFileById(sanitizedFileId);
    
    // Enforce access control
    if (!canAccessFile(file, req.user)) {
      // Log unauthorized access attempt
      await accessLogger.logFileAccess(sanitizedFileId, req.user.userId, 'view', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        success: false,
        error: 'Access denied'
      });
      throw commonErrors.forbidden('Access denied');
    }

    // Log successful access
    await accessLogger.logFileAccess(sanitizedFileId, req.user.userId, 'view', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      success: true
    });

    // Convert to expected format
    const responseFile = {
      id: file.fileId,
      originalName: file.originalName,
      size: file.size,
      mimetype: file.mimetype,
      uploadDate: file.createdAt,
      status: file.status,
      publicAccess: file.publicAccess,
      secureUrl: file.cloudinaryUrl,
      uploadedBy: (req.user.role === 'admin' || file.uploaderId === req.user.userId) ? file.uploaderId : undefined,
      thumbnailUrl: file.processingResult?.thumbnailUrl,
      processingResult: file.processingResult
    };

    res.json({ file: responseFile });
    
  } catch (error) {
    if (error.statusCode === 404) {
      // Log failed access attempt
      await accessLogger.logFileAccess(sanitizedFileId, req.user.userId, 'view', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        success: false,
        error: 'File not found'
      });
    }
    throw error;
  }
}));

// Upload file - REQUIRES AUTHENTICATION
router.post('/', authenticateToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw commonErrors.badRequest('No file provided');
  }

  const file = req.file;
  
  // Sanitize request body
  const bodyResult = inputSanitizer.sanitizeFileUpload(req.body);
  if (!bodyResult.isValid) {
    throw commonErrors.badRequest(`Invalid request data: ${bodyResult.errors.join(', ')}`);
  }
  
  const { createVersion = 'false', versionDescription = '', parentFileId } = bodyResult.sanitized;

  // Check memory constraints
  const memoryCheck = memoryMonitor.canAcceptUpload(file.size, file.originalname);
  if (!memoryCheck.allowed) {
    throw new AppError(memoryCheck.reason, 413);
  }

  // Register upload with memory monitor
  const uploadId = crypto.randomUUID();
  memoryMonitor.registerUpload(uploadId, file.size, file.originalname);
  
  // Initialize user quota if not exists
  let quota = require('../utils/storageQuotas').getUserQuota(req.user.userId);
  if (!quota) {
    initializeUserQuota(req.user.userId, req.user.role);
  }
  
  // Check storage quota
  const quotaCheck = canUserUploadFile(req.user.userId, file.size, file.mimetype);
  if (!quotaCheck.canUpload) {
    throw new AppError(`Upload denied: ${quotaCheck.errors.join(', ')}`, 413);
  }
  
  // Comprehensive file validation
  await validateFile(file);
  
  let fileBuffer = file.buffer;
  let encryptionMeta = null;
  
  // Handle encryption for metadata only (not for the Cloudinary upload)
  if (isEncryptionEnabled()) {
    // Generate encryption metadata without actually encrypting the buffer for Cloudinary
    const crypto = require('crypto');
    const encryptionKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    
    encryptionMeta = {
      algorithm: 'aes-256-gcm',
      keyId: crypto.randomUUID(),
      userId: req.user.userId,
      encryptedAt: new Date().toISOString(),
      // Store encryption info but don't encrypt the actual file for cloud storage
      encrypted: false // Mark as not encrypted since Cloudinary needs original data
    };
    
    const { logger } = require('../utils/logger');
    logger.info('Encryption metadata generated (file stored unencrypted for Cloudinary compatibility)', {
      keyId: encryptionMeta.keyId,
      algorithm: encryptionMeta.algorithm,
      userId: req.user.userId
    });
  }
  
  // Upload file to Cloudinary with enhanced error handling and compression
  let cloudinaryResult;
  try {
    // Use retry mechanism for upload with compression
    cloudinaryResult = await retryOperations.fileUpload(async () => {
      return saveFile(file.buffer, file.originalname, file.mimetype, {
        enableCompression: true,
        compressionOptions: {
          quality: req.body.compressionQuality ? parseInt(req.body.compressionQuality) : undefined
        }
      });
    }, {
      operationName: 'File Upload',
      originalName: file.originalname,
      mimetype: file.mimetype,
      fileSize: file.size,
      userId: req.user.userId
    });

    // Log compression results if available
    if (cloudinaryResult.compression) {
      const { logger } = require('../utils/logger');
      logger.info('File uploaded with compression', {
        originalName: file.originalname,
        originalSize: cloudinaryResult.compression.originalSize,
        compressedSize: cloudinaryResult.compression.compressedSize,
        compressionRatio: cloudinaryResult.compression.compressionRatio,
        sizeSaved: cloudinaryResult.compression.sizeSaved,
        userId: req.user.userId
      });
    }

  } catch (cloudinaryError) {
    // Clean up memory monitor before throwing
    memoryMonitor.unregisterUpload(uploadId);
    
    // Log the specific Cloudinary error
    const { logger } = require('../utils/logger');
    logger.error('Cloudinary upload failed in upload route', {
      error: cloudinaryError.message,
      originalName: file.originalname,
      mimetype: file.mimetype,
      fileSize: file.size,
      userId: req.user.userId,
      retryAttempts: cloudinaryError.retryAttempts || 0,
      totalDuration: cloudinaryError.totalDuration || 0,
      stack: cloudinaryError.stack
    });
    
    // Enhanced error handling with retry information
    if (cloudinaryError.message.includes('Invalid image file') || 
        cloudinaryError.message.includes('corrupted') ||
        cloudinaryError.message.includes('invalid format')) {
      throw commonErrors.badRequest('The uploaded file appears to be corrupted or in an unsupported format. Please try uploading a different file.');
    } else if (cloudinaryError.message.includes('File too large') || 
               cloudinaryError.message.includes('too large')) {
      throw commonErrors.payloadTooLarge('The uploaded file is too large. Please upload a smaller file.');
    } else if (cloudinaryError.retryAttempts && cloudinaryError.retryAttempts > 0) {
      throw commonErrors.temporaryFailure(`File upload failed after ${cloudinaryError.retryAttempts} attempts. Please try again later.`);
    } else {
      throw commonErrors.uploadFailed(`File upload failed: ${cloudinaryError.message}`);
    }
  }
  
  // Create file record in MongoDB
  const fileData = {
    originalName: file.originalname,
    cloudinaryUrl: cloudinaryResult.secureUrl,
    cloudinaryPublicId: cloudinaryResult.publicId,
    mimetype: file.mimetype,
    size: file.size,
    uploaderId: req.user.userId,
    status: 'uploaded',
    publicAccess: false,
    encryptionMeta: encryptionMeta,
    parentFileId: parentFileId || null,
    version: createVersion === 'true' ? 2 : 1 // Simple versioning
  };

  const newFile = await fileService.createFile(fileData);
  
  // Record file upload in quota system
  recordFileUpload(req.user.userId, newFile.fileId, file.size, file.mimetype, file.originalname);
  
  // Log file upload
  await accessLogger.logFileAccess(newFile.fileId, req.user.userId, 'upload', {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    fileName: file.originalname,
    fileSize: file.size,
    mimetype: file.mimetype
  });
  
  // Create file version if requested
  if (createVersion === 'true' && parentFileId) {
    try {
      await createFileVersion(
        parentFileId,
        file.buffer,
        file.originalname,
        file.mimetype,
        req.user.userId,
        versionDescription
      );
    } catch (versionError) {
      console.error('Failed to create file version:', versionError);
      // Continue with regular upload even if versioning fails
    }
  }

  // Determine processing priority based on file type and user role
  let processingPriority = JOB_PRIORITIES.NORMAL;
  if (req.user.role === 'admin') {
    processingPriority = JOB_PRIORITIES.HIGH;
  } else if (file.mimetype.startsWith('image/')) {
    processingPriority = JOB_PRIORITIES.HIGH; // Images process faster
  } else if (file.size > 10 * 1024 * 1024) { // Large files get lower priority
    processingPriority = JOB_PRIORITIES.LOW;
  }

  // Start enhanced background processing with queue
  const jobId = await enhancedProcessingTracker.startJob(newFile.fileId, {
    originalName: newFile.originalName,
    mimetype: newFile.mimetype,
    size: newFile.size,
    uploaderId: req.user.userId
  }, cloudinaryResult, {
    priority: processingPriority,
    compressionEnabled: req.body.enableCompression !== 'false',
    maxAttempts: 3,
    timeout: file.size > 50 * 1024 * 1024 ? 600000 : 300000 // 10 min for large files, 5 min for others
  });

  // Set up job completion handler
  const processingQueue = queueManager.getQueue('processing');
  
  processingQueue.once(`job:completed:${jobId}`, async (job, result) => {
    try {
      // Update file record in MongoDB
      await fileService.updateProcessingStatus(newFile.fileId, 'processed', result.result);
      
      const { logger } = require('../utils/logger');
      logger.info('File processing completed', {
        fileId: newFile.fileId,
        jobId,
        processingTime: job.completedAt - job.startedAt,
        attempts: job.attempts
      });
    } catch (error) {
      logger.error('Failed to update file processing status', {
        fileId: newFile.fileId,
        jobId,
        error: error.message
      });
    }
  });

  processingQueue.once(`job:failed:${jobId}`, async (job, error) => {
    try {
      // Update file record in MongoDB
      await fileService.updateProcessingStatus(newFile.fileId, 'failed', {
        error: error.message,
        attempts: job.attempts,
        failedAt: new Date().toISOString()
      });
      
      const { logger } = require('../utils/logger');
      logger.error('File processing failed permanently', {
        fileId: newFile.fileId,
        jobId,
        error: error.message,
        attempts: job.attempts
      });
    } catch (updateError) {
      logger.error('Failed to update file processing failure status', {
        fileId: newFile.fileId,
        jobId,
        error: updateError.message
      });
    }
  });

  // Clean up memory monitor registration after successful upload
  memoryMonitor.unregisterUpload(uploadId);

  res.set({
    'X-File-Id': newFile.fileId,
    'X-Job-Id': jobId,
    'X-Storage-Type': 'cloudinary',
    'X-Encrypted': !!encryptionMeta ? 'true' : 'false',
    'X-Compressed': cloudinaryResult.compression ? 'true' : 'false',
    'X-Quota-Used': quotaCheck.quotaInfo.storageUsed.toString(),
    'X-Quota-Remaining': quotaCheck.quotaInfo.storageAvailable.toString(),
    'Location': `/api/upload/${newFile.fileId}`
  });

  res.status(201).json({
    message: 'File uploaded successfully to Cloudinary',
    file: {
      id: newFile.fileId,
      originalName: newFile.originalName,
      size: newFile.size,
      mimetype: newFile.mimetype,
      uploadDate: newFile.createdAt,
      status: newFile.status,
      publicAccess: newFile.publicAccess,
      secureUrl: newFile.cloudinaryUrl
    },
    quotaInfo: {
      storageUsed: quotaCheck.quotaInfo.storageUsed,
      storageLimit: quotaCheck.quotaInfo.storageLimit,
      storageAvailable: quotaCheck.quotaInfo.storageAvailable,
      filesUsed: quotaCheck.quotaInfo.filesUsed,
      filesLimit: quotaCheck.quotaInfo.filesLimit
    },
    encryption: {
      enabled: isEncryptionEnabled(),
      encrypted: !!encryptionMeta && encryptionMeta.encrypted,
      note: isEncryptionEnabled() ? 'File stored unencrypted for cloud storage compatibility' : 'Encryption disabled'
    }
  });
}));

// Update file metadata - REQUIRES AUTHENTICATION
router.put('/:fileId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const updateData = req.body;
  
  const file = await fileService.getFileById(fileId);

  // Enforce ownership check
  if (file.uploaderId !== req.user.userId && req.user.role !== 'admin') {
    throw commonErrors.forbidden('You can only update your own files');
  }

  // Validate update data
  const allowedFields = ['publicAccess', 'originalName', 'description', 'tags'];
  const invalidFields = Object.keys(updateData).filter(key => !allowedFields.includes(key));
  
  if (invalidFields.length > 0) {
    throw commonErrors.badRequest(`Invalid fields: ${invalidFields.join(', ')}`);
  }

  // Validate field types
  if (updateData.publicAccess !== undefined && typeof updateData.publicAccess !== 'boolean') {
    throw commonErrors.badRequest('publicAccess must be a boolean');
  }
  if (updateData.originalName !== undefined && typeof updateData.originalName !== 'string') {
    throw commonErrors.badRequest('originalName must be a string');
  }
  if (updateData.description !== undefined && typeof updateData.description !== 'string') {
    throw commonErrors.badRequest('description must be a string');
  }
  if (updateData.tags !== undefined && !Array.isArray(updateData.tags)) {
    throw commonErrors.badRequest('tags must be an array');
  }

  // Update file in MongoDB
  const updatedFile = await fileService.updateFile(fileId, updateData);

  res.json({
    message: 'File metadata updated successfully',
    file: {
      id: updatedFile.fileId,
      originalName: updatedFile.originalName,
      size: updatedFile.size,
      mimetype: updatedFile.mimetype,
      uploadDate: updatedFile.createdAt,
      status: updatedFile.status,
      publicAccess: updatedFile.publicAccess,
      secureUrl: updatedFile.cloudinaryUrl,
      description: updatedFile.description,
      tags: updatedFile.tags
    }
  });
}));

// Delete file - REQUIRES AUTHENTICATION
router.delete('/:fileId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  const file = await fileService.getFileById(fileId);

  // Enforce ownership check
  if (file.uploaderId !== req.user.userId && req.user.role !== 'admin') {
    throw commonErrors.forbidden('You can only delete your own files');
  }

  // Delete file from Cloudinary
  if (file.cloudinaryPublicId) {
    try {
      // Determine resource type based on mimetype
      let resourceType = 'auto';
      if (file.mimetype.startsWith('image/')) {
        resourceType = 'image';
      } else if (file.mimetype.startsWith('video/')) {
        resourceType = 'video';
      } else {
        resourceType = 'raw';
      }
      
      await deleteFile(file.cloudinaryPublicId, resourceType);
    } catch (error) {
      console.error('Error deleting file from Cloudinary:', error);
      // Continue with database deletion even if Cloudinary deletion fails
    }
  }
  
  // Record file deletion in quota system
  try {
    recordFileDeletion(req.user.userId, fileId, file.size);
  } catch (quotaError) {
    console.error('Error updating quota after deletion:', quotaError);
    // Continue with deletion even if quota update fails
  }

  // Soft delete in MongoDB
  await fileService.deleteFile(fileId);

  res.json({ 
    message: 'File deleted successfully from Cloudinary',
    deletedFileId: fileId
  });
}));

// Get processing status - REQUIRES AUTHENTICATION
router.get('/:fileId/status', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  const file = await fileService.getFileById(fileId);

  // Enforce access control
  if (!canAccessFile(file, req.user)) {
    throw commonErrors.forbidden('You do not have permission to access this file');
  }

  // Get processing job status
  const job = processingTracker.getJob(fileId);
  
  res.json({
    fileId: file.fileId,
    status: file.status,
    processingJob: job ? {
      status: job.status,
      progress: job.progress,
      startTime: job.startTime,
      duration: job.duration,
      operation: job.operation
    } : null,
    processingResult: file.processingResult
  });
}));

// Download file - REQUIRES AUTHENTICATION
router.get('/:fileId/download', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  // Sanitize file ID
  const sanitizedFileId = inputSanitizer.sanitizeText(fileId, 50);
  if (!sanitizedFileId) {
    throw commonErrors.badRequest('Invalid file ID');
  }
  
  try {
    const file = await fileService.getFileById(sanitizedFileId);

    // Enforce access control
    if (!canAccessFile(file, req.user)) {
      // Log unauthorized download attempt
      await accessLogger.logFileAccess(sanitizedFileId, req.user.userId, 'download', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        success: false,
        error: 'Access denied'
      });
      throw commonErrors.forbidden('You do not have permission to access this file');
    }

    // Increment download count
    await fileService.incrementDownload(sanitizedFileId);

    // Log successful download
    await accessLogger.logFileAccess(sanitizedFileId, req.user.userId, 'download', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      fileName: file.originalName,
      fileSize: file.size
    });

    // Return Cloudinary secure URL for download
    res.json({
      message: 'File download authorized',
      fileId: file.fileId,
      filename: file.originalName,
      size: file.size,
      mimetype: file.mimetype,
      secureUrl: file.cloudinaryUrl,
      downloadUrl: file.cloudinaryUrl,
      storageProvider: 'cloudinary',
      note: 'File is served directly from Cloudinary CDN'
    });
    
  } catch (error) {
    if (error.statusCode === 404) {
      // Log failed download attempt
      await accessLogger.logFileAccess(sanitizedFileId, req.user.userId, 'download', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        success: false,
        error: 'File not found'
      });
    }
    throw error;
  }

  // Return Cloudinary secure URL for download
  res.json({
    message: 'File download authorized',
    fileId: file.id,
    filename: file.originalName,
    size: file.size,
    mimetype: file.mimetype,
    secureUrl: file.secureUrl,
    downloadUrl: file.secureUrl,
    storageProvider: 'cloudinary',
    note: 'File is served directly from Cloudinary CDN'
  });
}));

// Preview file - REQUIRES AUTHENTICATION  
router.get('/:fileId/preview', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  const file = await fileService.getFileById(fileId);

  // Enforce access control
  if (!canAccessFile(file, req.user)) {
    throw commonErrors.forbidden('You do not have permission to access this file');
  }

  // Return preview information
  const previewData = {
    fileId: file.fileId,
    filename: file.originalName,
    size: file.size,
    mimetype: file.mimetype,
    uploadDate: file.createdAt,
    status: file.status,
    secureUrl: file.cloudinaryUrl,
    storageProvider: 'cloudinary'
  };

  // Include processing result if available
  if (file.processingResult) {
    const { publicId, ...sanitizedResult } = file.processingResult;
    previewData.processingResult = sanitizedResult;
  }

  // For images, include thumbnail URL if available
  if (file.processingResult?.thumbnailUrl) {
    previewData.thumbnailUrl = file.processingResult.thumbnailUrl;
  }

  res.json(previewData);
}));

// Get processing job status
router.get('/job/:fileId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;

  // Check if user owns the file or is admin
  const file = await fileService.findFileById(fileId);
  if (!file) {
    throw commonErrors.notFound('File');
  }

  if (file.uploaderId !== req.user.userId && req.user.role !== 'admin') {
    throw commonErrors.forbidden('Access denied to this file');
  }

  const job = enhancedProcessingTracker.getJob(fileId);
  if (!job) {
    return res.json({
      fileId,
      status: 'not_found',
      message: 'No processing job found for this file'
    });
  }

  res.json({
    fileId,
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    attempts: job.attempts,
    startTime: job.startTime,
    errors: job.errors || [],
    result: job.result
  });
}));

// Cancel processing job
router.delete('/job/:fileId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;

  // Check if user owns the file or is admin
  const file = await fileService.findFileById(fileId);
  if (!file) {
    throw commonErrors.notFound('File');
  }

  if (file.uploaderId !== req.user.userId && req.user.role !== 'admin') {
    throw commonErrors.forbidden('Access denied to this file');
  }

  try {
    const cancelledJob = await enhancedProcessingTracker.cancelJob(fileId);
    
    res.json({
      success: true,
      message: 'Processing job cancelled successfully',
      jobId: cancelledJob.id
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      throw commonErrors.notFound('Processing job');
    } else if (error.message.includes('cannot cancel')) {
      throw commonErrors.badRequest('Job cannot be cancelled in its current state');
    } else {
      throw error;
    }
  }
}));

// Get queue statistics (admin only)
router.get('/queue/stats', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }

  const queueStats = enhancedProcessingTracker.getQueueStats();
  const allJobs = enhancedProcessingTracker.getAllJobs();

  // Filter jobs by user if requested
  let filteredJobs = allJobs;
  if (req.query.userId) {
    filteredJobs = allJobs.filter(job => job.userId === req.query.userId);
  }

  // Group jobs by status
  const jobsByStatus = filteredJobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  res.json({
    queue: queueStats,
    jobs: {
      total: filteredJobs.length,
      byStatus: jobsByStatus,
      recent: filteredJobs
        .sort((a, b) => new Date(b.updatedAt || b.startTime) - new Date(a.updatedAt || a.startTime))
        .slice(0, 10)
    }
  });
}));

// Get user's processing jobs
router.get('/jobs', authenticateToken, asyncHandler(async (req, res) => {
  const allJobs = enhancedProcessingTracker.getAllJobs();
  const userJobs = allJobs.filter(job => 
    job.userId === req.user.userId || req.user.role === 'admin'
  );

  // Apply filtering
  let filteredJobs = userJobs;
  if (req.query.status) {
    filteredJobs = userJobs.filter(job => job.status === req.query.status);
  }

  // Apply pagination
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const paginatedJobs = filteredJobs
    .sort((a, b) => new Date(b.updatedAt || b.startTime) - new Date(a.updatedAt || a.startTime))
    .slice(skip, skip + limit);

  res.json({
    jobs: paginatedJobs,
    pagination: {
      page,
      limit,
      total: filteredJobs.length,
      pages: Math.ceil(filteredJobs.length / limit)
    }
  });
}));

// Retry failed processing job
router.post('/job/:fileId/retry', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;

  // Check if user owns the file or is admin
  const file = await fileService.findFileById(fileId);
  if (!file) {
    throw commonErrors.notFound('File');
  }

  if (file.uploaderId !== req.user.userId && req.user.role !== 'admin') {
    throw commonErrors.forbidden('Access denied to this file');
  }

  try {
    // Re-fetch file from cloudinary if needed for retry
    const cloudinaryResult = {
      publicId: file.cloudinaryPublicId,
      secureUrl: file.cloudinaryUrl,
      size: file.size,
      format: file.mimetype
    };

    const jobId = await enhancedProcessingTracker.startJob(fileId, {
      originalName: file.originalName,
      mimetype: file.mimetype,
      size: file.size,
      uploaderId: file.uploaderId
    }, cloudinaryResult, {
      priority: JOB_PRIORITIES.HIGH, // High priority for retries
      maxAttempts: 2 // Fewer attempts for retries
    });

    res.json({
      success: true,
      message: 'Processing job restarted successfully',
      jobId,
      fileId
    });

  } catch (error) {
    throw commonErrors.temporaryFailure(`Failed to restart processing: ${error.message}`);
  }
}));

module.exports = router;
