const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger');
const { saveFile, deleteFile } = require('./fileStorage');

const fileVersions = new Map();

async function createFileVersion(originalFileId, fileBuffer, originalName, mimetype, userId, changeDescription = '') {
  try {
    const versionId = uuidv4();
    const versionNumber = getNextVersionNumber(originalFileId);
    
    const storageResult = await saveFile(fileBuffer, originalName, mimetype, {
      public_id: `file-processing/versions/${originalFileId}-v${versionNumber}-${Date.now()}`
    });
    
    const version = {
      versionId,
      originalFileId,
      versionNumber,
      originalName,
      mimetype,
      size: fileBuffer.length,
      publicId: storageResult.publicId,
      secureUrl: storageResult.secureUrl,
      createdBy: userId,
      createdAt: new Date().toISOString(),
      changeDescription,
      isActive: true,
      storageResult
    };

    if (!fileVersions.has(originalFileId)) {
      fileVersions.set(originalFileId, []);
    }
    fileVersions.get(originalFileId).push(version);
    
    logger.info('File version created', {
      originalFileId,
      versionId,
      versionNumber,
      userId
    });
    
    return version;
  } catch (error) {
    logger.error('Failed to create file version', {
      error: error.message,
      originalFileId,
      userId
    });
    throw error;
  }
}

function getFileVersions(fileId, userId, userRole) {
  const versions = fileVersions.get(fileId) || [];
  
  return versions
    .filter(version => version.isActive)
    .filter(version => {
      return version.createdBy === userId || userRole === 'admin';
    })
    .sort((a, b) => b.versionNumber - a.versionNumber); 
}

function getFileVersion(fileId, versionId, userId, userRole) {
  const versions = fileVersions.get(fileId) || [];
  const version = versions.find(v => v.versionId === versionId && v.isActive);
  
  if (!version) {
    return null;
  }
  
  if (version.createdBy !== userId && userRole !== 'admin') {
    return null;
  }
  
  return version;
}

async function deleteFileVersion(fileId, versionId, userId, userRole) {
  try {
    const versions = fileVersions.get(fileId) || [];
    const versionIndex = versions.findIndex(v => v.versionId === versionId);
    
    if (versionIndex === -1) {
      throw new Error('Version not found');
    }
    
    const version = versions[versionIndex];
    
    if (version.createdBy !== userId && userRole !== 'admin') {
      throw new Error('Access denied');
    }
    
    const activeVersions = versions.filter(v => v.isActive);
    if (activeVersions.length <= 1) {
      throw new Error('Cannot delete the only version of a file');
    }
    
    version.isActive = false;
    version.deletedAt = new Date().toISOString();
    version.deletedBy = userId;
    
    logger.info('File version deleted', {
      fileId,
      versionId,
      versionNumber: version.versionNumber,
      userId
    });
    
    return true;
  } catch (error) {
    logger.error('Failed to delete file version', {
      error: error.message,
      fileId,
      versionId,
      userId
    });
    throw error;
  }
}

function getNextVersionNumber(fileId) {
  const versions = fileVersions.get(fileId) || [];
  const maxVersion = versions.reduce((max, version) => {
    return Math.max(max, version.versionNumber);
  }, 0);
  return maxVersion + 1;
}

module.exports = {
  createFileVersion,
  getFileVersions,
  getFileVersion,
  deleteFileVersion
};