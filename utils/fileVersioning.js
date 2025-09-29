const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger');
const { saveFile, deleteFile } = require('./fileStorage');

/**
 * File Versioning System
 * Manages file versions and tracks changes
 */

// In-memory storage for file versions (use database in production)
const fileVersions = new Map();

/**
 * Create a new file version
 */
async function createFileVersion(originalFileId, fileBuffer, originalName, mimetype, userId, changeDescription = '') {
  try {
    const versionId = uuidv4();
    const versionNumber = getNextVersionNumber(originalFileId);
    
    // Upload new version to storage
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
    
    // Store version
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

/**
 * Get all versions of a file
 */
function getFileVersions(fileId, userId, userRole) {
  const versions = fileVersions.get(fileId) || [];
  
  // Filter versions based on access control
  return versions
    .filter(version => version.isActive)
    .filter(version => {
      // Owner or admin can see all versions
      return version.createdBy === userId || userRole === 'admin';
    })
    .sort((a, b) => b.versionNumber - a.versionNumber); // Latest first
}

/**
 * Get specific version
 */
function getFileVersion(fileId, versionId, userId, userRole) {
  const versions = fileVersions.get(fileId) || [];
  const version = versions.find(v => v.versionId === versionId && v.isActive);
  
  if (!version) {
    return null;
  }
  
  // Check access control
  if (version.createdBy !== userId && userRole !== 'admin') {
    return null;
  }
  
  return version;
}

/**
 * Get latest version of a file
 */
function getLatestVersion(fileId, userId, userRole) {
  const versions = getFileVersions(fileId, userId, userRole);
  return versions.length > 0 ? versions[0] : null;
}

/**
 * Delete a specific version
 */
async function deleteFileVersion(fileId, versionId, userId, userRole) {
  try {
    const versions = fileVersions.get(fileId) || [];
    const versionIndex = versions.findIndex(v => v.versionId === versionId);
    
    if (versionIndex === -1) {
      throw new Error('Version not found');
    }
    
    const version = versions[versionIndex];
    
    // Check access control
    if (version.createdBy !== userId && userRole !== 'admin') {
      throw new Error('Access denied');
    }
    
    // Don't allow deletion of the only version
    const activeVersions = versions.filter(v => v.isActive);
    if (activeVersions.length <= 1) {
      throw new Error('Cannot delete the only version of a file');
    }
    
    // Mark as inactive instead of deleting
    version.isActive = false;
    version.deletedAt = new Date().toISOString();
    version.deletedBy = userId;
    
    // Optionally delete from storage (commented out to preserve data)
    // await deleteFile(version.publicId, getResourceType(version.mimetype));
    
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

/**
 * Restore a specific version (make it the latest)
 */
async function restoreFileVersion(fileId, versionId, userId, userRole) {
  try {
    const version = getFileVersion(fileId, versionId, userId, userRole);
    
    if (!version) {
      throw new Error('Version not found or access denied');
    }
    
    // Create a new version based on the restored version
    const restoredVersion = await createFileVersion(
      fileId,
      null, // We don't have the buffer, so this would need to be fetched from storage
      version.originalName,
      version.mimetype,
      userId,
      `Restored from version ${version.versionNumber}`
    );
    
    // Copy the storage details from the original version
    restoredVersion.publicId = version.publicId;
    restoredVersion.secureUrl = version.secureUrl;
    restoredVersion.size = version.size;
    
    logger.info('File version restored', {
      fileId,
      restoredVersionId: versionId,
      newVersionId: restoredVersion.versionId,
      userId
    });
    
    return restoredVersion;
  } catch (error) {
    logger.error('Failed to restore file version', {
      error: error.message,
      fileId,
      versionId,
      userId
    });
    throw error;
  }
}

/**
 * Get version comparison data
 */
function compareVersions(fileId, version1Id, version2Id, userId, userRole) {
  const version1 = getFileVersion(fileId, version1Id, userId, userRole);
  const version2 = getFileVersion(fileId, version2Id, userId, userRole);
  
  if (!version1 || !version2) {
    throw new Error('One or both versions not found');
  }
  
  return {
    version1: {
      versionId: version1.versionId,
      versionNumber: version1.versionNumber,
      createdAt: version1.createdAt,
      createdBy: version1.createdBy,
      size: version1.size,
      changeDescription: version1.changeDescription
    },
    version2: {
      versionId: version2.versionId,
      versionNumber: version2.versionNumber,
      createdAt: version2.createdAt,
      createdBy: version2.createdBy,
      size: version2.size,
      changeDescription: version2.changeDescription
    },
    differences: {
      sizeDifference: version2.size - version1.size,
      timeDifference: new Date(version2.createdAt) - new Date(version1.createdAt),
      createdByDifferent: version1.createdBy !== version2.createdBy
    }
  };
}

/**
 * Get next version number for a file
 */
function getNextVersionNumber(fileId) {
  const versions = fileVersions.get(fileId) || [];
  const maxVersion = versions.reduce((max, version) => {
    return Math.max(max, version.versionNumber);
  }, 0);
  return maxVersion + 1;
}

/**
 * Get resource type based on mimetype
 */
function getResourceType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  return 'raw';
}

/**
 * Get version statistics for a file
 */
function getVersionStats(fileId, userId, userRole) {
  const versions = getFileVersions(fileId, userId, userRole);
  
  if (versions.length === 0) {
    return null;
  }
  
  const totalSize = versions.reduce((sum, v) => sum + v.size, 0);
  const contributors = [...new Set(versions.map(v => v.createdBy))];
  
  return {
    totalVersions: versions.length,
    totalSize,
    contributors: contributors.length,
    oldestVersion: versions[versions.length - 1],
    latestVersion: versions[0],
    averageSize: Math.round(totalSize / versions.length)
  };
}

/**
 * Clean up old versions (keep only N latest versions)
 */
async function cleanupOldVersions(fileId, keepCount = 10) {
  try {
    const versions = fileVersions.get(fileId) || [];
    const activeVersions = versions.filter(v => v.isActive);
    
    if (activeVersions.length <= keepCount) {
      return 0; // Nothing to clean up
    }
    
    // Sort by version number and keep only the latest N
    const sortedVersions = activeVersions.sort((a, b) => b.versionNumber - a.versionNumber);
    const versionsToDelete = sortedVersions.slice(keepCount);
    
    let deletedCount = 0;
    for (const version of versionsToDelete) {
      version.isActive = false;
      version.deletedAt = new Date().toISOString();
      version.deletedBy = 'system';
      deletedCount++;
    }
    
    logger.info('Old versions cleaned up', {
      fileId,
      deletedCount,
      keepCount
    });
    
    return deletedCount;
  } catch (error) {
    logger.error('Failed to cleanup old versions', {
      error: error.message,
      fileId
    });
    throw error;
  }
}

module.exports = {
  createFileVersion,
  getFileVersions,
  getFileVersion,
  getLatestVersion,
  deleteFileVersion,
  restoreFileVersion,
  compareVersions,
  getVersionStats,
  cleanupOldVersions
};