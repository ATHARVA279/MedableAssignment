const express = require("express");
const multer = require("multer");

const { authenticateToken } = require("../middleware/auth");
const { validateFile } = require("../middleware/fileValidation");
const {
  AppError,
  asyncHandler,
  commonErrors,
} = require("../middleware/errorHandler");
const {
  saveFile,
  deleteFile,
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
const { inputSanitizer } = require("../utils/inputSanitizer");
const { retryOperations } = require("../utils/retryManager");
const {
  queueManager,
  JOB_TYPES,
  JOB_PRIORITIES,
} = require("../utils/jobQueue");
const { logger } = require("../utils/logger");

const { fileService } = require("../services/fileService");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, 
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

    await validateFile(file);

    let fileBuffer = file.buffer;
    let encryptionMeta = null;

    if (isEncryptionEnabled()) {
      const crypto = require("crypto");

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

    let deletedCloudinaryPublicId = null;

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

        const deleteResult = await deleteFile(file.cloudinaryPublicId, resourceType);
        deletedCloudinaryPublicId = deleteResult.deletedPublicId;
        
        logger.info("File moved to Cloudinary deleted folder", {
          fileId,
          originalPublicId: file.cloudinaryPublicId,
          deletedPublicId: deletedCloudinaryPublicId
        });
      } catch (error) {
        logger.error("Error soft deleting file from Cloudinary:", {
          error: error.message,
          fileId,
          cloudinaryPublicId: file.cloudinaryPublicId
        });
      }
    }

    await fileService.deleteFile(fileId, deletedCloudinaryPublicId);

    res.json({
      message: "File soft deleted successfully",
      deletedFileId: fileId,
      canRestore: !!deletedCloudinaryPublicId,
    });
  })
);

router.post(
  "/:fileId/restore",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;

    const file = await fileService.getFileById(fileId);

    if (file.uploaderId !== req.user.userId && req.user.role !== "admin") {
      throw commonErrors.forbidden("You can only restore your own files");
    }

    if (file.status !== 'deleted') {
      throw commonErrors.badRequest("File is not in deleted status");
    }

    if (!file.deletedCloudinaryPublicId) {
      throw commonErrors.badRequest("File cannot be restored - no backup reference found");
    }

    const restoredFile = await fileService.restoreFile(fileId);

    res.json({
      message: "File restored successfully",
      restoredFileId: fileId,
      file: {
        fileId: restoredFile.fileId,
        originalName: restoredFile.originalName,
        cloudinaryUrl: restoredFile.cloudinaryUrl,
        status: restoredFile.status,
      }
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

module.exports = router;
