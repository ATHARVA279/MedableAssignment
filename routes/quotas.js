const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler, commonErrors } = require('../middleware/errorHandler');
const {
  initializeUserQuota,
  getUserQuota,
  getUserUsage,
  updateUserQuota,
  getQuotaUsageStats,
  getAllUsersQuotaSummary,
  checkQuotaWarnings,
  DEFAULT_QUOTAS
} = require('../utils/storageQuotas');

const router = express.Router();

/**
 * Get current user's quota and usage
 * GET /api/quotas/me
 */
router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  let quota = getUserQuota(req.user.userId);
  
  // Initialize quota if not exists
  if (!quota) {
    quota = initializeUserQuota(req.user.userId, req.user.role);
  }
  
  const stats = getQuotaUsageStats(req.user.userId);
  const warnings = checkQuotaWarnings(req.user.userId);
  
  res.json({
    quota: {
      userId: quota.userId,
      userRole: quota.userRole,
      maxStorage: quota.maxStorage,
      maxFiles: quota.maxFiles,
      maxFileSize: quota.maxFileSize,
      maxDailyUploads: quota.maxDailyUploads,
      allowedFileTypes: quota.allowedFileTypes,
      createdAt: quota.createdAt,
      updatedAt: quota.updatedAt
    },
    usage: stats,
    warnings
  });
}));

/**
 * Get quota usage statistics
 * GET /api/quotas/stats
 */
router.get('/stats', authenticateToken, asyncHandler(async (req, res) => {
  const stats = getQuotaUsageStats(req.user.userId);
  
  res.json({
    stats
  });
}));

/**
 * Get quota warnings
 * GET /api/quotas/warnings
 */
router.get('/warnings', authenticateToken, asyncHandler(async (req, res) => {
  const warnings = checkQuotaWarnings(req.user.userId);
  
  res.json({
    warnings,
    hasWarnings: warnings.length > 0,
    criticalWarnings: warnings.filter(w => w.level === 'critical').length,
    regularWarnings: warnings.filter(w => w.level === 'warning').length
  });
}));

/**
 * Get specific user's quota (admin only)
 * GET /api/quotas/user/:userId
 */
router.get('/user/:userId', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }
  
  const { userId } = req.params;
  
  const quota = getUserQuota(userId);
  const usage = getUserUsage(userId);
  
  if (!quota || !usage) {
    throw commonErrors.notFound('User quota not found');
  }
  
  const stats = getQuotaUsageStats(userId);
  const warnings = checkQuotaWarnings(userId);
  
  res.json({
    userId,
    quota,
    usage: stats,
    warnings
  });
}));

/**
 * Update user's quota (admin only)
 * PUT /api/quotas/user/:userId
 */
router.put('/user/:userId', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }
  
  const { userId } = req.params;
  const updateData = req.body;
  
  // Validate update data
  const allowedFields = ['maxStorage', 'maxFiles', 'maxFileSize', 'maxDailyUploads', 'allowedFileTypes'];
  const invalidFields = Object.keys(updateData).filter(key => !allowedFields.includes(key));
  
  if (invalidFields.length > 0) {
    throw commonErrors.badRequest(`Invalid fields: ${invalidFields.join(', ')}`);
  }
  
  // Validate numeric fields
  const numericFields = ['maxStorage', 'maxFiles', 'maxFileSize', 'maxDailyUploads'];
  for (const field of numericFields) {
    if (updateData[field] !== undefined) {
      if (typeof updateData[field] !== 'number' || updateData[field] < 0) {
        throw commonErrors.badRequest(`${field} must be a positive number`);
      }
    }
  }
  
  // Validate allowedFileTypes
  if (updateData.allowedFileTypes !== undefined) {
    if (!Array.isArray(updateData.allowedFileTypes)) {
      throw commonErrors.badRequest('allowedFileTypes must be an array');
    }
  }
  
  const updatedQuota = updateUserQuota(userId, updateData);
  
  res.json({
    message: 'User quota updated successfully',
    quota: updatedQuota
  });
}));

/**
 * Initialize quota for user (admin only)
 * POST /api/quotas/user/:userId/initialize
 */
router.post('/user/:userId/initialize', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }
  
  const { userId } = req.params;
  const { userRole = 'user', customQuota } = req.body;
  
  // Check if quota already exists
  const existingQuota = getUserQuota(userId);
  if (existingQuota) {
    throw commonErrors.badRequest('User quota already exists');
  }
  
  const quota = initializeUserQuota(userId, userRole, customQuota);
  
  res.status(201).json({
    message: 'User quota initialized successfully',
    quota
  });
}));

/**
 * Get all users quota summary (admin only)
 * GET /api/quotas/admin/summary
 */
router.get('/admin/summary', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }
  
  const { sortBy = 'storagePercentage', order = 'desc', limit = '50' } = req.query;
  
  let summary = getAllUsersQuotaSummary();
  
  // Sort results
  const validSortFields = ['storagePercentage', 'storageUsed', 'filesUsed', 'lastUploadDate'];
  if (validSortFields.includes(sortBy)) {
    summary.sort((a, b) => {
      if (order === 'asc') {
        return a[sortBy] - b[sortBy];
      } else {
        return b[sortBy] - a[sortBy];
      }
    });
  }
  
  // Apply limit
  const limitNum = parseInt(limit) || 50;
  summary = summary.slice(0, limitNum);
  
  // Calculate overall statistics
  const totalUsers = summary.length;
  const totalStorageUsed = summary.reduce((sum, user) => sum + user.storageUsed, 0);
  const totalFilesUsed = summary.reduce((sum, user) => sum + user.filesUsed, 0);
  const usersOverLimit = summary.filter(user => user.storagePercentage >= 100).length;
  const usersNearLimit = summary.filter(user => user.storagePercentage >= 75 && user.storagePercentage < 100).length;
  
  res.json({
    summary,
    statistics: {
      totalUsers,
      totalStorageUsed,
      totalFilesUsed,
      usersOverLimit,
      usersNearLimit,
      averageStorageUsage: totalUsers > 0 ? Math.round(totalStorageUsed / totalUsers) : 0
    },
    pagination: {
      limit: limitNum,
      total: totalUsers,
      sortBy,
      order
    }
  });
}));

/**
 * Get default quota templates
 * GET /api/quotas/templates
 */
router.get('/templates', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }
  
  res.json({
    templates: DEFAULT_QUOTAS,
    description: 'Default quota templates for different user roles'
  });
}));

/**
 * Check if user can upload file (utility endpoint)
 * POST /api/quotas/check-upload
 */
router.post('/check-upload', authenticateToken, asyncHandler(async (req, res) => {
  const { fileSize, mimetype } = req.body;
  
  if (!fileSize || !mimetype) {
    throw commonErrors.badRequest('fileSize and mimetype are required');
  }
  
  // Initialize quota if not exists
  let quota = getUserQuota(req.user.userId);
  if (!quota) {
    quota = initializeUserQuota(req.user.userId, req.user.role);
  }
  
  const { canUserUploadFile } = require('../utils/storageQuotas');
  const result = canUserUploadFile(req.user.userId, fileSize, mimetype);
  
  res.json({
    canUpload: result.canUpload,
    checks: result.checks,
    errors: result.errors,
    quotaInfo: result.quotaInfo
  });
}));

/**
 * Reset user's daily upload count (admin only)
 * POST /api/quotas/user/:userId/reset-daily
 */
router.post('/user/:userId/reset-daily', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }
  
  const { userId } = req.params;
  
  const usage = getUserUsage(userId);
  if (!usage) {
    throw commonErrors.notFound('User usage not found');
  }
  
  usage.dailyUploads = 0;
  usage.lastUploadDate = null;
  
  res.json({
    message: 'Daily upload count reset successfully',
    userId,
    dailyUploads: usage.dailyUploads
  });
}));

module.exports = router;