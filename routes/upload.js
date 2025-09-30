const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const path = require("path");

const { authenticateToken, optionalAuth } = require("../middleware/auth");
const { validateFile } = require("../middleware/fileValidation");
const {
  AppError,
  asyncHandler,
  asyncHandlerWithRetry,
  commonErrors,
} = require("../middleware/errorHandler");
const {
  saveFile,
  deleteFile,
  fileExists,
  generateThumbnailUrl,
} = require("../utils/fileStorage");
const {
  processFile,
  enhancedProcessingTracker,
} = require("../utils/enhancedFileProcessor");
const {
  encryptFileForStorage,
  isEncryptionEnabled,
} = require("../utils/fileEncryption");
const { createFileVersion } = require("../utils/fileVersioning");
const { memoryMonitor } = require("../utils/memoryMonitor");
const { networkTimeoutHandler } = require("../utils/networkTimeout");
const { inputSanitizer } = require("../utils/inputSanitizer");
const { retryOperations } = require("../utils/retryManager");
const { FileCompressor } = require("../utils/fileCompression");
const {
  queueManager,
  JOB_TYPES,
  JOB_PRIORITIES,
} = require("../utils/jobQueue");

const { fileService } = require("../services/fileService");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "text/csv",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(`File type ${file.mimetype} is not allowed`, 415));
    }
  },
});

function canAccessFile(file, user) {
  if (!file) return false;

  if (file.publicAccess) return true;

  const fileOwnerId = file.uploadedBy || file.uploaderId;
  if (user && fileOwnerId === user.userId) return true;

  if (user && user.role === "admin") return true;

  return false;
}

function sanitizeFileData(file, user, includeProcessingResult = false) {
  const sanitized = {
    id: file.id,
    originalName: file.originalName,
    size: file.size,
    mimetype: file.mimetype,
    uploadDate: file.uploadDate,
    status: file.status,
    publicAccess: file.publicAccess,
  };

  if (canAccessFile(file, user)) {
    sanitized.secureUrl = file.secureUrl;

    if (file.processingResult?.thumbnailUrl) {
      sanitized.thumbnailUrl = file.processingResult.thumbnailUrl;
    }
  }

  if (user && (file.uploadedBy === user.userId || user.role === "admin")) {
    sanitized.uploadedBy = file.uploadedBy;
  }

  if (
    includeProcessingResult &&
    canAccessFile(file, user) &&
    file.processingResult
  ) {
    const { publicId, ...sanitizedProcessingResult } = file.processingResult;
    sanitized.processingResult = sanitizedProcessingResult;
  }

  return sanitized;
}

router.get(
  "/",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const queryResult = inputSanitizer.sanitizeQueryParams(req.query);
    if (!queryResult.isValid) {
      throw commonErrors.badRequest(
        `Invalid query parameters: ${queryResult.errors.join(", ")}`
      );
    }

    const sanitizedQuery = queryResult.sanitized;
    const page = Math.max(1, parseInt(sanitizedQuery.page) || 1);
    const limit = Math.min(
      50,
      Math.max(1, parseInt(sanitizedQuery.limit) || 20)
    );
    const status = sanitizedQuery.status;
    const publicOnly = sanitizedQuery.public === "true";
    const search = sanitizedQuery.search;

    let result;

    if (publicOnly) {
      result = await fileService.getPublicFiles({
        page,
        limit,
        mimetype: sanitizedQuery.mimetype,
        search,
      });
    } else {
      const uploaderId = req.user.role === "admin" ? null : req.user.userId;

      if (search) {
        result = await fileService.searchFiles(search, uploaderId, {
          page,
          limit,
        });
      } else {
        result = await fileService.getFilesByUploader(
          uploaderId || req.user.userId,
          {
            page,
            limit,
            status,
            mimetype: sanitizedQuery.mimetype,
            publicAccess: sanitizedQuery.publicAccess,
          }
        );
      }
    }

    const File = require("../models/File");
    const processingCount = await File.countDocuments({ status: "processing" });

    res.set({
      "X-Total-Files": result.pagination.total.toString(),
      "X-Processing-Queue": processingCount.toString(),
    });

    const sanitizedFiles = result.files.map((file) => ({
      id: file.fileId,
      originalName: file.originalName,
      size: file.size,
      mimetype: file.mimetype,
      uploadDate: file.createdAt,
      status: file.status,
      publicAccess: file.publicAccess,
      secureUrl: file.cloudinaryUrl,
      uploadedBy:
        req.user.role === "admin" || file.uploaderId === req.user.userId
          ? file.uploaderId
          : undefined,
      thumbnailUrl: file.processingResult?.thumbnailUrl,
      processingResult: file.processingResult,
    }));

    res.json({
      files: sanitizedFiles,
      pagination: result.pagination,
    });
  })
);

router.get(
  "/:fileId",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const sanitizedFileId = inputSanitizer.sanitizeText(fileId, 50);
    if (!sanitizedFileId) {
      throw commonErrors.badRequest("Invalid file ID");
    }

    try {
      const file = await fileService.getFileById(sanitizedFileId);

      if (!canAccessFile(file, req.user)) {
        throw commonErrors.forbidden("Access denied");
      }

      const responseFile = {
        id: file.fileId,
        originalName: file.originalName,
        size: file.size,
        mimetype: file.mimetype,
        uploadDate: file.createdAt,
        status: file.status,
        publicAccess: file.publicAccess,
        secureUrl: file.cloudinaryUrl,
        uploadedBy:
          req.user.role === "admin" || file.uploaderId === req.user.userId
            ? file.uploaderId
            : undefined,
        thumbnailUrl: file.processingResult?.thumbnailUrl,
        processingResult: file.processingResult,
      };

      res.json({ file: responseFile });
    } catch (error) {
      if (error.statusCode === 404) {
        
      }
      throw error;
    }
  })
);

router.post(
  "/",
  authenticateToken,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw commonErrors.badRequest("No file provided");
    }

    const file = req.file;

    const bodyResult = inputSanitizer.sanitizeFileUpload(req.body);
    if (!bodyResult.isValid) {
      throw commonErrors.badRequest(
        `Invalid request data: ${bodyResult.errors.join(", ")}`
      );
    }

    const {
      createVersion = "false",
      versionDescription = "",
      parentFileId,
    } = bodyResult.sanitized;

    const memoryCheck = memoryMonitor.canAcceptUpload(
      file.size,
      file.originalname
    );
    if (!memoryCheck.allowed) {
      throw new AppError(memoryCheck.reason, 413);
    }

    const uploadId = crypto.randomUUID();
    memoryMonitor.registerUpload(uploadId, file.size, file.originalname);

    await validateFile(file);

    let fileBuffer = file.buffer;
    let encryptionMeta = null;

    if (isEncryptionEnabled()) {
      const crypto = require("crypto");
      const encryptionKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);

      encryptionMeta = {
        algorithm: "aes-256-gcm",
        keyId: crypto.randomUUID(),
        userId: req.user.userId,
        encryptedAt: new Date().toISOString(),
        encrypted: false, 
      };

      const { logger } = require("../utils/logger");
      logger.info(
        "Encryption metadata generated (file stored unencrypted for Cloudinary compatibility)",
        {
          keyId: encryptionMeta.keyId,
          algorithm: encryptionMeta.algorithm,
          userId: req.user.userId,
        }
      );
    }

    let cloudinaryResult;
    try {
      cloudinaryResult = await retryOperations.fileUpload(
        async () => {
          return saveFile(file.buffer, file.originalname, file.mimetype, {
            enableCompression: true,
            compressionOptions: {
              quality: req.body.compressionQuality
                ? parseInt(req.body.compressionQuality)
                : undefined,
            },
          });
        },
        {
          operationName: "File Upload",
          originalName: file.originalname,
          mimetype: file.mimetype,
          fileSize: file.size,
          userId: req.user.userId,
        }
      );

      if (cloudinaryResult.compression) {
        const { logger } = require("../utils/logger");
        logger.info("File uploaded with compression", {
          originalName: file.originalname,
          originalSize: cloudinaryResult.compression.originalSize,
          compressedSize: cloudinaryResult.compression.compressedSize,
          compressionRatio: cloudinaryResult.compression.compressionRatio,
          sizeSaved: cloudinaryResult.compression.sizeSaved,
          userId: req.user.userId,
        });
      }
    } catch (cloudinaryError) {
      memoryMonitor.unregisterUpload(uploadId);

      const { logger } = require("../utils/logger");
      logger.error("Cloudinary upload failed in upload route", {
        error: cloudinaryError.message,
        originalName: file.originalname,
        mimetype: file.mimetype,
        fileSize: file.size,
        userId: req.user.userId,
        retryAttempts: cloudinaryError.retryAttempts || 0,
        totalDuration: cloudinaryError.totalDuration || 0,
        stack: cloudinaryError.stack,
      });

      if (
        cloudinaryError.message.includes("Invalid image file") ||
        cloudinaryError.message.includes("corrupted") ||
        cloudinaryError.message.includes("invalid format")
      ) {
        throw commonErrors.badRequest(
          "The uploaded file appears to be corrupted or in an unsupported format. Please try uploading a different file."
        );
      } else if (
        cloudinaryError.message.includes("File too large") ||
        cloudinaryError.message.includes("too large")
      ) {
        throw commonErrors.payloadTooLarge(
          "The uploaded file is too large. Please upload a smaller file."
        );
      } else if (
        cloudinaryError.retryAttempts &&
        cloudinaryError.retryAttempts > 0
      ) {
        throw commonErrors.temporaryFailure(
          `File upload failed after ${cloudinaryError.retryAttempts} attempts. Please try again later.`
        );
      } else {
        throw commonErrors.uploadFailed(
          `File upload failed: ${cloudinaryError.message}`
        );
      }
    }

    const fileData = {
      originalName: file.originalname,
      cloudinaryUrl: cloudinaryResult.secureUrl,
      cloudinaryPublicId: cloudinaryResult.publicId,
      mimetype: file.mimetype,
      size: file.size,
      uploaderId: req.user.userId,
      status: "uploaded",
      publicAccess: false,
      encryptionMeta: encryptionMeta,
      parentFileId: parentFileId || null,
      version: createVersion === "true" ? 2 : 1,
    };

    const newFile = await fileService.createFile(fileData);

    if (createVersion === "true" && parentFileId) {
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
        console.error("Failed to create file version:", versionError);
      }
    }

    let processingPriority = JOB_PRIORITIES.NORMAL;
    if (req.user.role === "admin") {
      processingPriority = JOB_PRIORITIES.HIGH;
    } else if (file.mimetype.startsWith("image/")) {
      processingPriority = JOB_PRIORITIES.HIGH;
    } else if (file.size > 10 * 1024 * 1024) {
      processingPriority = JOB_PRIORITIES.LOW;
    }

    const jobId = await enhancedProcessingTracker.startJob(
      newFile.fileId,
      {
        originalName: newFile.originalName,
        mimetype: newFile.mimetype,
        size: newFile.size,
        uploaderId: req.user.userId,
      },
      cloudinaryResult,
      {
        priority: processingPriority,
        compressionEnabled: req.body.enableCompression !== "false",
        maxAttempts: 3,
        timeout: file.size > 50 * 1024 * 1024 ? 600000 : 300000, 
      }
    );

    const processingQueue = queueManager.getQueue("processing");

    processingQueue.once(`job:completed:${jobId}`, async (job, result) => {
      try {
        await fileService.updateProcessingStatus(
          newFile.fileId,
          "processed",
          result.result
        );

        const { logger } = require("../utils/logger");
        logger.info("File processing completed", {
          fileId: newFile.fileId,
          jobId,
          processingTime: job.completedAt - job.startedAt,
          attempts: job.attempts,
        });
      } catch (error) {
        logger.error("Failed to update file processing status", {
          fileId: newFile.fileId,
          jobId,
          error: error.message,
        });
      }
    });

    processingQueue.once(`job:failed:${jobId}`, async (job, error) => {
      try {
        await fileService.updateProcessingStatus(newFile.fileId, "failed", {
          error: error.message,
          attempts: job.attempts,
          failedAt: new Date().toISOString(),
        });

        const { logger } = require("../utils/logger");
        logger.error("File processing failed permanently", {
          fileId: newFile.fileId,
          jobId,
          error: error.message,
          attempts: job.attempts,
        });
      } catch (updateError) {
        logger.error("Failed to update file processing failure status", {
          fileId: newFile.fileId,
          jobId,
          error: updateError.message,
        });
      }
    });

    memoryMonitor.unregisterUpload(uploadId);

    res.set({
      "X-File-Id": newFile.fileId,
      "X-Job-Id": jobId,
      "X-Storage-Type": "cloudinary",
      "X-Encrypted": !!encryptionMeta ? "true" : "false",
      "X-Compressed": cloudinaryResult.compression ? "true" : "false",
      Location: `/api/upload/${newFile.fileId}`,
    });

    res.status(201).json({
      message: "File uploaded successfully to Cloudinary",
      file: {
        id: newFile.fileId,
        originalName: newFile.originalName,
        size: newFile.size,
        mimetype: newFile.mimetype,
        uploadDate: newFile.createdAt,
        status: newFile.status,
        publicAccess: newFile.publicAccess,
        secureUrl: newFile.cloudinaryUrl,
      },
      encryption: {
        enabled: isEncryptionEnabled(),
        encrypted: !!encryptionMeta && encryptionMeta.encrypted,
        note: isEncryptionEnabled()
          ? "File stored unencrypted for cloud storage compatibility"
          : "Encryption disabled",
      },
    });
  })
);

router.put(
  "/:fileId",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;
    const updateData = req.body;

    const file = await fileService.getFileById(fileId);

    if (file.uploaderId !== req.user.userId && req.user.role !== "admin") {
      throw commonErrors.forbidden("You can only update your own files");
    }

    const allowedFields = [
      "publicAccess",
      "originalName",
      "description",
      "tags",
    ];
    const invalidFields = Object.keys(updateData).filter(
      (key) => !allowedFields.includes(key)
    );

    if (invalidFields.length > 0) {
      throw commonErrors.badRequest(
        `Invalid fields: ${invalidFields.join(", ")}`
      );
    }

    if (
      updateData.publicAccess !== undefined &&
      typeof updateData.publicAccess !== "boolean"
    ) {
      throw commonErrors.badRequest("publicAccess must be a boolean");
    }
    if (
      updateData.originalName !== undefined &&
      typeof updateData.originalName !== "string"
    ) {
      throw commonErrors.badRequest("originalName must be a string");
    }
    if (
      updateData.description !== undefined &&
      typeof updateData.description !== "string"
    ) {
      throw commonErrors.badRequest("description must be a string");
    }
    if (updateData.tags !== undefined && !Array.isArray(updateData.tags)) {
      throw commonErrors.badRequest("tags must be an array");
    }

    const updatedFile = await fileService.updateFile(fileId, updateData);

    res.json({
      message: "File metadata updated successfully",
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
        tags: updatedFile.tags,
      },
    });
  })
);

router.delete(
  "/:fileId",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const file = await fileService.getFileById(fileId);

    if (file.uploaderId !== req.user.userId && req.user.role !== "admin") {
      throw commonErrors.forbidden("You can only delete your own files");
    }

    if (file.cloudinaryPublicId) {
      try {
        let resourceType = "auto";
        if (file.mimetype.startsWith("image/")) {
          resourceType = "image";
        } else if (file.mimetype.startsWith("video/")) {
          resourceType = "video";
        } else {
          resourceType = "raw";
        }

        await deleteFile(file.cloudinaryPublicId, resourceType);
      } catch (error) {
        console.error("Error deleting file from Cloudinary:", error);
      }
    }

    await fileService.deleteFile(fileId);

    res.json({
      message: "File deleted successfully from Cloudinary",
      deletedFileId: fileId,
    });
  })
);

router.get(
  "/:fileId/status",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const file = await fileService.getFileById(fileId);

    // Enforce access control
    if (!canAccessFile(file, req.user)) {
      throw commonErrors.forbidden(
        "You do not have permission to access this file"
      );
    }

    const job = processingTracker.getJob(fileId);

    res.json({
      fileId: file.fileId,
      status: file.status,
      processingJob: job
        ? {
            status: job.status,
            progress: job.progress,
            startTime: job.startTime,
            duration: job.duration,
            operation: job.operation,
          }
        : null,
      processingResult: file.processingResult,
    });
  })
);

router.get(
  "/:fileId/download",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const sanitizedFileId = inputSanitizer.sanitizeText(fileId, 50);
    if (!sanitizedFileId) {
      throw commonErrors.badRequest("Invalid file ID");
    }

    try {
      const file = await fileService.getFileById(sanitizedFileId);

      if (!canAccessFile(file, req.user)) {
        throw commonErrors.forbidden(
          "You do not have permission to access this file"
        );
      }

      await fileService.incrementDownload(sanitizedFileId);

      res.json({
        message: "File download authorized",
        fileId: file.fileId,
        filename: file.originalName,
        size: file.size,
        mimetype: file.mimetype,
        secureUrl: file.cloudinaryUrl,
        downloadUrl: file.cloudinaryUrl,
        storageProvider: "cloudinary",
        note: "File is served directly from Cloudinary CDN",
      });
    } catch (error) {
      if (error.statusCode === 404) {

      }
      throw error;
    }

    res.json({
      message: "File download authorized",
      fileId: file.id,
      filename: file.originalName,
      size: file.size,
      mimetype: file.mimetype,
      secureUrl: file.secureUrl,
      downloadUrl: file.secureUrl,
      storageProvider: "cloudinary",
      note: "File is served directly from Cloudinary CDN",
    });
  })
);

router.get(
  "/:fileId/preview",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const file = await fileService.getFileById(fileId);

    if (!canAccessFile(file, req.user)) {
      throw commonErrors.forbidden(
        "You do not have permission to access this file"
      );
    }

    const previewData = {
      fileId: file.fileId,
      filename: file.originalName,
      size: file.size,
      mimetype: file.mimetype,
      uploadDate: file.createdAt,
      status: file.status,
      secureUrl: file.cloudinaryUrl,
      storageProvider: "cloudinary",
    };

    if (file.processingResult) {
      const { publicId, ...sanitizedResult } = file.processingResult;
      previewData.processingResult = sanitizedResult;
    }

    if (file.processingResult?.thumbnailUrl) {
      previewData.thumbnailUrl = file.processingResult.thumbnailUrl;
    }

    res.json(previewData);
  })
);

router.get(
  "/job/:fileId",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const file = await fileService.findFileById(fileId);
    if (!file) {
      throw commonErrors.notFound("File");
    }

    if (file.uploaderId !== req.user.userId && req.user.role !== "admin") {
      throw commonErrors.forbidden("Access denied to this file");
    }

    const job = enhancedProcessingTracker.getJob(fileId);
    if (!job) {
      return res.json({
        fileId,
        status: "not_found",
        message: "No processing job found for this file",
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
      result: job.result,
    });
  })
);

router.delete(
  "/job/:fileId",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const file = await fileService.findFileById(fileId);
    if (!file) {
      throw commonErrors.notFound("File");
    }

    if (file.uploaderId !== req.user.userId && req.user.role !== "admin") {
      throw commonErrors.forbidden("Access denied to this file");
    }

    try {
      const cancelledJob = await enhancedProcessingTracker.cancelJob(fileId);

      res.json({
        success: true,
        message: "Processing job cancelled successfully",
        jobId: cancelledJob.id,
      });
    } catch (error) {
      if (error.message.includes("not found")) {
        throw commonErrors.notFound("Processing job");
      } else if (error.message.includes("cannot cancel")) {
        throw commonErrors.badRequest(
          "Job cannot be cancelled in its current state"
        );
      } else {
        throw error;
      }
    }
  })
);

router.get(
  "/queue/stats",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "admin") {
      throw commonErrors.forbidden("Admin access required");
    }

    const queueStats = enhancedProcessingTracker.getQueueStats();
    const allJobs = enhancedProcessingTracker.getAllJobs();

    let filteredJobs = allJobs;
    if (req.query.userId) {
      filteredJobs = allJobs.filter((job) => job.userId === req.query.userId);
    }

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
          .sort(
            (a, b) =>
              new Date(b.updatedAt || b.startTime) -
              new Date(a.updatedAt || a.startTime)
          )
          .slice(0, 10),
      },
    });
  })
);

router.get(
  "/jobs",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const allJobs = enhancedProcessingTracker.getAllJobs();
    const userJobs = allJobs.filter(
      (job) => job.userId === req.user.userId || req.user.role === "admin"
    );

    let filteredJobs = userJobs;
    if (req.query.status) {
      filteredJobs = userJobs.filter((job) => job.status === req.query.status);
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const paginatedJobs = filteredJobs
      .sort(
        (a, b) =>
          new Date(b.updatedAt || b.startTime) -
          new Date(a.updatedAt || a.startTime)
      )
      .slice(skip, skip + limit);

    res.json({
      jobs: paginatedJobs,
      pagination: {
        page,
        limit,
        total: filteredJobs.length,
        pages: Math.ceil(filteredJobs.length / limit),
      },
    });
  })
);

router.post(
  "/job/:fileId/retry",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const file = await fileService.findFileById(fileId);
    if (!file) {
      throw commonErrors.notFound("File");
    }

    if (file.uploaderId !== req.user.userId && req.user.role !== "admin") {
      throw commonErrors.forbidden("Access denied to this file");
    }

    try {
      const cloudinaryResult = {
        publicId: file.cloudinaryPublicId,
        secureUrl: file.cloudinaryUrl,
        size: file.size,
        format: file.mimetype,
      };

      const jobId = await enhancedProcessingTracker.startJob(
        fileId,
        {
          originalName: file.originalName,
          mimetype: file.mimetype,
          size: file.size,
          uploaderId: file.uploaderId,
        },
        cloudinaryResult,
        {
          priority: JOB_PRIORITIES.HIGH, 
          maxAttempts: 2,
        }
      );

      res.json({
        success: true,
        message: "Processing job restarted successfully",
        jobId,
        fileId,
      });
    } catch (error) {
      throw commonErrors.temporaryFailure(
        `Failed to restart processing: ${error.message}`
      );
    }
  })
);

module.exports = router;
