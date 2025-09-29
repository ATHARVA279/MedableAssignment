const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { validateFile } = require('../middleware/fileValidation');
const { asyncHandler, commonErrors } = require('../middleware/errorHandler');
const {
  createFileVersion,
  getFileVersions,
  getFileVersion,
  getLatestVersion,
  deleteFileVersion,
  restoreFileVersion,
  compareVersions,
  getVersionStats
} = require('../utils/fileVersioning');

const router = express.Router();

// Configure multer for version uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 1
  }
});

/**
 * Get all versions of a file
 * GET /api/versions/:fileId
 */
router.get('/:fileId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  const versions = getFileVersions(fileId, req.user.userId, req.user.role);
  
  res.json({
    fileId,
    versions: versions.map(version => ({
      versionId: version.versionId,
      versionNumber: version.versionNumber,
      originalName: version.originalName,
      size: version.size,
      mimetype: version.mimetype,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      changeDescription: version.changeDescription,
      secureUrl: version.secureUrl
    })),
    totalVersions: versions.length
  });
}));

/**
 * Get specific version details
 * GET /api/versions/:fileId/:versionId
 */
router.get('/:fileId/:versionId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId, versionId } = req.params;
  
  const version = getFileVersion(fileId, versionId, req.user.userId, req.user.role);
  
  if (!version) {
    throw commonErrors.notFound('Version');
  }
  
  res.json({
    versionId: version.versionId,
    originalFileId: version.originalFileId,
    versionNumber: version.versionNumber,
    originalName: version.originalName,
    size: version.size,
    mimetype: version.mimetype,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    changeDescription: version.changeDescription,
    secureUrl: version.secureUrl,
    publicId: version.publicId
  });
}));

/**
 * Create new version of a file
 * POST /api/versions/:fileId
 */
router.post('/:fileId', authenticateToken, upload.single('file'), asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const { changeDescription = '' } = req.body;
  
  if (!req.file) {
    throw commonErrors.badRequest('No file provided');
  }
  
  const file = req.file;
  
  // Validate file
  await validateFile(file);
  
  // Create new version
  const version = await createFileVersion(
    fileId,
    file.buffer,
    file.originalname,
    file.mimetype,
    req.user.userId,
    changeDescription
  );
  
  res.status(201).json({
    message: 'File version created successfully',
    version: {
      versionId: version.versionId,
      originalFileId: version.originalFileId,
      versionNumber: version.versionNumber,
      originalName: version.originalName,
      size: version.size,
      createdAt: version.createdAt,
      changeDescription: version.changeDescription,
      secureUrl: version.secureUrl
    }
  });
}));

/**
 * Delete a specific version
 * DELETE /api/versions/:fileId/:versionId
 */
router.delete('/:fileId/:versionId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId, versionId } = req.params;
  
  await deleteFileVersion(fileId, versionId, req.user.userId, req.user.role);
  
  res.json({
    message: 'Version deleted successfully',
    fileId,
    versionId
  });
}));

/**
 * Restore a specific version
 * POST /api/versions/:fileId/:versionId/restore
 */
router.post('/:fileId/:versionId/restore', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId, versionId } = req.params;
  
  const restoredVersion = await restoreFileVersion(fileId, versionId, req.user.userId, req.user.role);
  
  res.json({
    message: 'Version restored successfully',
    restoredVersion: {
      versionId: restoredVersion.versionId,
      versionNumber: restoredVersion.versionNumber,
      originalName: restoredVersion.originalName,
      createdAt: restoredVersion.createdAt,
      secureUrl: restoredVersion.secureUrl
    }
  });
}));

/**
 * Compare two versions
 * GET /api/versions/:fileId/compare/:version1Id/:version2Id
 */
router.get('/:fileId/compare/:version1Id/:version2Id', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId, version1Id, version2Id } = req.params;
  
  const comparison = compareVersions(fileId, version1Id, version2Id, req.user.userId, req.user.role);
  
  res.json({
    fileId,
    comparison
  });
}));

/**
 * Get version statistics
 * GET /api/versions/:fileId/stats
 */
router.get('/:fileId/stats', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  const stats = getVersionStats(fileId, req.user.userId, req.user.role);
  
  if (!stats) {
    throw commonErrors.notFound('File or versions');
  }
  
  res.json({
    fileId,
    stats
  });
}));

/**
 * Get latest version
 * GET /api/versions/:fileId/latest
 */
router.get('/:fileId/latest', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  
  const latestVersion = getLatestVersion(fileId, req.user.userId, req.user.role);
  
  if (!latestVersion) {
    throw commonErrors.notFound('Latest version');
  }
  
  res.json({
    fileId,
    latestVersion: {
      versionId: latestVersion.versionId,
      versionNumber: latestVersion.versionNumber,
      originalName: latestVersion.originalName,
      size: latestVersion.size,
      createdBy: latestVersion.createdBy,
      createdAt: latestVersion.createdAt,
      changeDescription: latestVersion.changeDescription,
      secureUrl: latestVersion.secureUrl
    }
  });
}));

module.exports = router;