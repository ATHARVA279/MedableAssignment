const { logger } = require('./logger');
const config = require('../config');

const userQuotas = new Map();
const userUsage = new Map();

const DEFAULT_QUOTAS = {
  user: {
    maxStorage: 100 * 1024 * 1024,    
    maxFiles: 50,                    
    maxFileSize: 10 * 1024 * 1024,   
    maxDailyUploads: 20,             
    allowedFileTypes: ['image/jpeg', 'image/png', 'application/pdf', 'text/csv']
  },
  admin: {
    maxStorage: 1024 * 1024 * 1024,  
    maxFiles: 500,                    
    maxFileSize: 50 * 1024 * 1024,    
    maxDailyUploads: 100,             
    allowedFileTypes: ['*']          
  },
  premium: {
    maxStorage: 500 * 1024 * 1024,   
    maxFiles: 200,                   
    maxFileSize: 25 * 1024 * 1024,   
    maxDailyUploads: 50,             
    allowedFileTypes: ['image/jpeg', 'image/png', 'application/pdf', 'text/csv', 'video/mp4']
  }
};

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

function getUserQuota(userId) {
  return userQuotas.get(userId);
}

function getUserUsage(userId) {
  return userUsage.get(userId);
}

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
    
    if (usage.totalStorage + fileSize <= quota.maxStorage) {
      checks.storageLimit = true;
    } else {
      errors.push(`Storage limit exceeded. Used: ${formatBytes(usage.totalStorage)}, Limit: ${formatBytes(quota.maxStorage)}, File size: ${formatBytes(fileSize)}`);
    }
    
    if (usage.totalFiles < quota.maxFiles) {
      checks.fileCountLimit = true;
    } else {
      errors.push(`File count limit exceeded. Current: ${usage.totalFiles}, Limit: ${quota.maxFiles}`);
    }
    
    if (fileSize <= quota.maxFileSize) {
      checks.fileSizeLimit = true;
    } else {
      errors.push(`File size limit exceeded. File size: ${formatBytes(fileSize)}, Limit: ${formatBytes(quota.maxFileSize)}`);
    }
    
    const today = new Date().toDateString();
    const lastUploadDate = usage.lastUploadDate ? new Date(usage.lastUploadDate).toDateString() : null;
    
    if (lastUploadDate !== today) {
      usage.dailyUploads = 0;
    }
    
    if (usage.dailyUploads < quota.maxDailyUploads) {
      checks.dailyUploadLimit = true;
    } else {
      errors.push(`Daily upload limit exceeded. Today: ${usage.dailyUploads}, Limit: ${quota.maxDailyUploads}`);
    }
    
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

function recordFileUpload(userId, fileId, fileSize, mimetype, filename) {
  try {
    const usage = getUserUsage(userId);
    
    if (!usage) {
      throw new Error('User usage not initialized');
    }
    
    usage.totalStorage += fileSize;
    usage.totalFiles += 1;
    
    const today = new Date().toDateString();
    const lastUploadDate = usage.lastUploadDate ? new Date(usage.lastUploadDate).toDateString() : null;
    
    if (lastUploadDate !== today) {
      usage.dailyUploads = 1;
      usage.dailyUploadHistory.push({
        date: today,
        uploads: 1
      });
    } else {
      usage.dailyUploads += 1;
      const todayHistory = usage.dailyUploadHistory.find(h => h.date === today);
      if (todayHistory) {
        todayHistory.uploads = usage.dailyUploads;
      }
    }
    
    usage.lastUploadDate = new Date().toISOString();
    
    usage.files.push({
      fileId,
      filename,
      size: fileSize,
      mimetype,
      uploadedAt: new Date().toISOString()
    });
    
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

function recordFileDeletion(userId, fileId, fileSize) {
  try {
    const usage = getUserUsage(userId);
    
    if (!usage) {
      throw new Error('User usage not initialized');
    }
    
    usage.totalStorage = Math.max(0, usage.totalStorage - fileSize);
    usage.totalFiles = Math.max(0, usage.totalFiles - 1);
    
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

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function checkQuotaWarnings(userId) {
  try {
    const stats = getQuotaUsageStats(userId);
    const warnings = [];
    
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