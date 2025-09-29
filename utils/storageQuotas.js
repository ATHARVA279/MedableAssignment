const { logger } = require('./logger');
const config = require('../config');

/**
 * Storage Quotas System
 * Manages per-user storage limits and usage tracking
 */

// In-memory storage for user quotas and usage (use database in production)
const userQuotas = new Map();
const userUsage = new Map();

// Default quota settings
const DEFAULT_QUOTAS = {
  user: {
    maxStorage: 100 * 1024 * 1024,    // 100MB
    maxFiles: 50,                     // 50 files
    maxFileSize: 10 * 1024 * 1024,    // 10MB per file
    maxDailyUploads: 20,              // 20 uploads per day
    allowedFileTypes: ['image/jpeg', 'image/png', 'application/pdf', 'text/csv']
  },
  admin: {
    maxStorage: 1024 * 1024 * 1024,   // 1GB
    maxFiles: 500,                    // 500 files
    maxFileSize: 50 * 1024 * 1024,    // 50MB per file
    maxDailyUploads: 100,             // 100 uploads per day
    allowedFileTypes: ['*']           // All file types
  },
  premium: {
    maxStorage: 500 * 1024 * 1024,    // 500MB
    maxFiles: 200,                    // 200 files
    maxFileSize: 25 * 1024 * 1024,    // 25MB per file
    maxDailyUploads: 50,              // 50 uploads per day
    allowedFileTypes: ['image/jpeg', 'image/png', 'application/pdf', 'text/csv', 'video/mp4']
  }
};

/**
 * Initialize user quota
 */
function initializeUserQuota(userId, userRole = 'user', customQuota = null) {
  try {
    const quota = customQuota || DEFAULT_QUOTAS[userRole] || DEFAULT_QUOTAS.user;
    
    userQuotas.set(userId, {
      userId,
      userRole,
      ...quota,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    // Initialize usage tracking
    if (!userUsage.has(userId)) {
      userUsage.set(userId, {
        userId,
        totalStorage: 0,
        totalFiles: 0,
        dailyUploads: 0,
        lastUploadDate: null,
        files: [],
        dailyUploadHistory: []
      });
    }
    
    logger.info('User quota initialized', {
      userId,
      userRole,
      maxStorage: quota.maxStorage,
      maxFiles: quota.maxFiles
    });
    
    return userQuotas.get(userId);
  } catch (error) {
    logger.error('Failed to initialize user quota', {
      error: error.message,
      userId,
      userRole
    });
    throw error;
  }
}

/**
 * Get user quota information
 */
function getUserQuota(userId) {
  return userQuotas.get(userId);
}

/**
 * Get user usage information
 */
function getUserUsage(userId) {
  return userUsage.get(userId);
}

/**
 * Check if user can upload file
 */
function canUserUploadFile(userId, fileSize, mimetype) {
  try {
    const quota = getUserQuota(userId);
    const usage = getUserUsage(userId);
    
    if (!quota || !usage) {
      throw new Error('User quota not initialized');
    }
    
    const checks = {
      storageLimit: false,
      fileCountLimit: false,
      fileSizeLimit: false,
      dailyUploadLimit: false,
      fileTypeAllowed: false
    };
    
    const errors = [];
    
    // Check storage limit
    if (usage.totalStorage + fileSize <= quota.maxStorage) {
      checks.storageLimit = true;
    } else {
      errors.push(`Storage limit exceeded. Used: ${formatBytes(usage.totalStorage)}, Limit: ${formatBytes(quota.maxStorage)}, File size: ${formatBytes(fileSize)}`);
    }
    
    // Check file count limit
    if (usage.totalFiles < quota.maxFiles) {
      checks.fileCountLimit = true;
    } else {
      errors.push(`File count limit exceeded. Current: ${usage.totalFiles}, Limit: ${quota.maxFiles}`);
    }
    
    // Check individual file size limit
    if (fileSize <= quota.maxFileSize) {
      checks.fileSizeLimit = true;
    } else {
      errors.push(`File size limit exceeded. File size: ${formatBytes(fileSize)}, Limit: ${formatBytes(quota.maxFileSize)}`);
    }
    
    // Check daily upload limit
    const today = new Date().toDateString();
    const lastUploadDate = usage.lastUploadDate ? new Date(usage.lastUploadDate).toDateString() : null;
    
    if (lastUploadDate !== today) {
      // Reset daily counter for new day
      usage.dailyUploads = 0;
    }
    
    if (usage.dailyUploads < quota.maxDailyUploads) {
      checks.dailyUploadLimit = true;
    } else {
      errors.push(`Daily upload limit exceeded. Today: ${usage.dailyUploads}, Limit: ${quota.maxDailyUploads}`);
    }
    
    // Check file type
    if (quota.allowedFileTypes.includes('*') || quota.allowedFileTypes.includes(mimetype)) {
      checks.fileTypeAllowed = true;
    } else {
      errors.push(`File type not allowed. Type: ${mimetype}, Allowed: ${quota.allowedFileTypes.join(', ')}`);
    }
    
    const canUpload = Object.values(checks).every(check => check === true);
    
    return {
      canUpload,
      checks,
      errors,
      quotaInfo: {
        storageUsed: usage.totalStorage,
        storageLimit: quota.maxStorage,
        storageAvailable: quota.maxStorage - usage.totalStorage,
        filesUsed: usage.totalFiles,
        filesLimit: quota.maxFiles,
        dailyUploadsUsed: usage.dailyUploads,
        dailyUploadsLimit: quota.maxDailyUploads
      }
    };
  } catch (error) {
    logger.error('Failed to check upload permission', {
      error: error.message,
      userId,
      fileSize,
      mimetype
    });
    throw error;
  }
}

/**
 * Record file upload in usage tracking
 */
function recordFileUpload(userId, fileId, fileSize, mimetype, filename) {
  try {
    const usage = getUserUsage(userId);
    
    if (!usage) {
      throw new Error('User usage not initialized');
    }
    
    // Update usage statistics
    usage.totalStorage += fileSize;
    usage.totalFiles += 1;
    
    // Update daily uploads
    const today = new Date().toDateString();
    const lastUploadDate = usage.lastUploadDate ? new Date(usage.lastUploadDate).toDateString() : null;
    
    if (lastUploadDate !== today) {
      // New day, reset counter
      usage.dailyUploads = 1;
      usage.dailyUploadHistory.push({
        date: today,
        uploads: 1
      });
    } else {
      usage.dailyUploads += 1;
      // Update today's count in history
      const todayHistory = usage.dailyUploadHistory.find(h => h.date === today);
      if (todayHistory) {
        todayHistory.uploads = usage.dailyUploads;
      }
    }
    
    usage.lastUploadDate = new Date().toISOString();
    
    // Add file to tracking
    usage.files.push({
      fileId,
      filename,
      size: fileSize,
      mimetype,
      uploadedAt: new Date().toISOString()
    });
    
    // Keep only last 30 days of daily upload history
    usage.dailyUploadHistory = usage.dailyUploadHistory.slice(-30);
    
    logger.info('File upload recorded', {
      userId,
      fileId,
      fileSize,
      totalStorage: usage.totalStorage,
      totalFiles: usage.totalFiles
    });
    
    return usage;
  } catch (error) {
    logger.error('Failed to record file upload', {
      error: error.message,
      userId,
      fileId
    });
    throw error;
  }
}

/**
 * Record file deletion in usage tracking
 */
function recordFileDeletion(userId, fileId, fileSize) {
  try {
    const usage = getUserUsage(userId);
    
    if (!usage) {
      throw new Error('User usage not initialized');
    }
    
    // Update usage statistics
    usage.totalStorage = Math.max(0, usage.totalStorage - fileSize);
    usage.totalFiles = Math.max(0, usage.totalFiles - 1);
    
    // Remove file from tracking
    usage.files = usage.files.filter(file => file.fileId !== fileId);
    
    logger.info('File deletion recorded', {
      userId,
      fileId,
      fileSize,
      totalStorage: usage.totalStorage,
      totalFiles: usage.totalFiles
    });
    
    return usage;
  } catch (error) {
    logger.error('Failed to record file deletion', {
      error: error.message,
      userId,
      fileId
    });
    throw error;
  }
}

/**
 * Update user quota
 */
function updateUserQuota(userId, newQuota) {
  try {
    const currentQuota = getUserQuota(userId);
    
    if (!currentQuota) {
      throw new Error('User quota not found');
    }
    
    const updatedQuota = {
      ...currentQuota,
      ...newQuota,
      updatedAt: new Date().toISOString()
    };
    
    userQuotas.set(userId, updatedQuota);
    
    logger.info('User quota updated', {
      userId,
      changes: newQuota
    });
    
    return updatedQuota;
  } catch (error) {
    logger.error('Failed to update user quota', {
      error: error.message,
      userId
    });
    throw error;
  }
}

/**
 * Get quota usage statistics
 */
function getQuotaUsageStats(userId) {
  try {
    const quota = getUserQuota(userId);
    const usage = getUserUsage(userId);
    
    if (!quota || !usage) {
      throw new Error('User quota or usage not found');
    }
    
    const storagePercentage = Math.round((usage.totalStorage / quota.maxStorage) * 100);
    const filesPercentage = Math.round((usage.totalFiles / quota.maxFiles) * 100);
    const dailyUploadsPercentage = Math.round((usage.dailyUploads / quota.maxDailyUploads) * 100);
    
    return {
      storage: {
        used: usage.totalStorage,
        limit: quota.maxStorage,
        available: quota.maxStorage - usage.totalStorage,
        percentage: storagePercentage,
        formatted: {
          used: formatBytes(usage.totalStorage),
          limit: formatBytes(quota.maxStorage),
          available: formatBytes(quota.maxStorage - usage.totalStorage)
        }
      },
      files: {
        used: usage.totalFiles,
        limit: quota.maxFiles,
        available: quota.maxFiles - usage.totalFiles,
        percentage: filesPercentage
      },
      dailyUploads: {
        used: usage.dailyUploads,
        limit: quota.maxDailyUploads,
        available: quota.maxDailyUploads - usage.dailyUploads,
        percentage: dailyUploadsPercentage
      },
      fileSize: {
        limit: quota.maxFileSize,
        formatted: formatBytes(quota.maxFileSize)
      },
      allowedFileTypes: quota.allowedFileTypes,
      lastUploadDate: usage.lastUploadDate
    };
  } catch (error) {
    logger.error('Failed to get quota usage stats', {
      error: error.message,
      userId
    });
    throw error;
  }
}

/**
 * Get all users quota summary (admin only)
 */
function getAllUsersQuotaSummary() {
  const summary = [];
  
  for (const [userId, quota] of userQuotas.entries()) {
    const usage = getUserUsage(userId);
    
    if (usage) {
      summary.push({
        userId,
        userRole: quota.userRole,
        storageUsed: usage.totalStorage,
        storageLimit: quota.maxStorage,
        storagePercentage: Math.round((usage.totalStorage / quota.maxStorage) * 100),
        filesUsed: usage.totalFiles,
        filesLimit: quota.maxFiles,
        lastUploadDate: usage.lastUploadDate
      });
    }
  }
  
  return summary.sort((a, b) => b.storagePercentage - a.storagePercentage);
}

/**
 * Clean up old daily upload history
 */
function cleanupOldHistory() {
  let cleanedUsers = 0;
  
  for (const [userId, usage] of userUsage.entries()) {
    const originalLength = usage.dailyUploadHistory.length;
    usage.dailyUploadHistory = usage.dailyUploadHistory.slice(-30);
    
    if (usage.dailyUploadHistory.length < originalLength) {
      cleanedUsers++;
    }
  }
  
  logger.info('Cleaned up old upload history', {
    cleanedUsers
  });
  
  return cleanedUsers;
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Check if user is approaching quota limits
 */
function checkQuotaWarnings(userId) {
  try {
    const stats = getQuotaUsageStats(userId);
    const warnings = [];
    
    // Storage warnings
    if (stats.storage.percentage >= 90) {
      warnings.push({
        type: 'storage',
        level: 'critical',
        message: `Storage usage is at ${stats.storage.percentage}% (${stats.storage.formatted.used} of ${stats.storage.formatted.limit})`
      });
    } else if (stats.storage.percentage >= 75) {
      warnings.push({
        type: 'storage',
        level: 'warning',
        message: `Storage usage is at ${stats.storage.percentage}% (${stats.storage.formatted.used} of ${stats.storage.formatted.limit})`
      });
    }
    
    // File count warnings
    if (stats.files.percentage >= 90) {
      warnings.push({
        type: 'files',
        level: 'critical',
        message: `File count is at ${stats.files.percentage}% (${stats.files.used} of ${stats.files.limit} files)`
      });
    } else if (stats.files.percentage >= 75) {
      warnings.push({
        type: 'files',
        level: 'warning',
        message: `File count is at ${stats.files.percentage}% (${stats.files.used} of ${stats.files.limit} files)`
      });
    }
    
    // Daily upload warnings
    if (stats.dailyUploads.percentage >= 90) {
      warnings.push({
        type: 'dailyUploads',
        level: 'critical',
        message: `Daily uploads at ${stats.dailyUploads.percentage}% (${stats.dailyUploads.used} of ${stats.dailyUploads.limit} today)`
      });
    }
    
    return warnings;
  } catch (error) {
    logger.error('Failed to check quota warnings', {
      error: error.message,
      userId
    });
    return [];
  }
}

module.exports = {
  initializeUserQuota,
  getUserQuota,
  getUserUsage,
  canUserUploadFile,
  recordFileUpload,
  recordFileDeletion,
  updateUserQuota,
  getQuotaUsageStats,
  getAllUsersQuotaSummary,
  cleanupOldHistory,
  checkQuotaWarnings,
  formatBytes,
  DEFAULT_QUOTAS
};