const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { validateFile } = require('../middleware/fileValidation');
const { asyncHandler, commonErrors } = require('../middleware/errorHandler');
const {
  createFileVersion,
  getFileVersions,
  getFileVersion,
  deleteFileVersion,
} = require('../utils/fileVersioning');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, 
    files: 1
  }
});

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

router.post('/:fileId', authenticateToken, upload.single('file'), asyncHandler(async (req, res) => {
  const { fileId } = req.params;
  const { changeDescription = '' } = req.body;
  
  if (!req.file) {
    throw commonErrors.badRequest('No file provided');
  }
  
  const file = req.file;
  
  await validateFile(file);
  
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

router.delete('/:fileId/:versionId', authenticateToken, asyncHandler(async (req, res) => {
  const { fileId, versionId } = req.params;
  
  await deleteFileVersion(fileId, versionId, req.user.userId, req.user.role);
  
  res.json({
    message: 'Version deleted successfully',
    fileId,
    versionId
  });
}));

module.exports = router;