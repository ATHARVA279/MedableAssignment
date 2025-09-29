const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { asyncHandler, commonErrors } = require("../middleware/errorHandler");
const { accessLogger } = require("../utils/accessLogger");
const { memoryMonitor } = require("../utils/memoryMonitor");
const { virusScanner } = require("../utils/virusScanner");
const { backupRecovery } = require("../utils/backupRecovery");
const { networkTimeoutHandler } = require("../utils/networkTimeout");
const { inputSanitizer } = require("../utils/inputSanitizer");

const router = express.Router();

// Admin authentication middleware
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

// Get access logs - ADMIN ONLY
router.get(
  "/access-logs",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const queryResult = inputSanitizer.sanitizeQueryParams(req.query);
    if (!queryResult.isValid) {
      throw commonErrors.badRequest(
        `Invalid query parameters: ${queryResult.errors.join(", ")}`
      );
    }

    const {
      fileId,
      userId,
      action,
      limit = "100",
      timeRange = "24h",
    } = queryResult.sanitized;
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit)));

    let logs;
    if (fileId) {
      logs = accessLogger.getFileAccessLogs(fileId, limitNum);
    } else if (userId) {
      logs = accessLogger.getUserActivityLogs(userId, limitNum);
    } else {
      // Get system-wide statistics
      const stats = accessLogger.getAccessStatistics(timeRange);
      return res.json({
        statistics: stats,
        note: "Use fileId or userId parameter to get specific logs",
      });
    }

    res.json({
      logs,
      count: logs.length,
      filters: { fileId, userId, action, timeRange },
    });
  })
);

// Export access logs - ADMIN ONLY
router.get(
  "/access-logs/export",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const queryResult = inputSanitizer.sanitizeQueryParams(req.query);
    if (!queryResult.isValid) {
      throw commonErrors.badRequest(
        `Invalid query parameters: ${queryResult.errors.join(", ")}`
      );
    }

    const { startDate, endDate, format = "json" } = queryResult.sanitized;

    if (!startDate || !endDate) {
      throw commonErrors.badRequest("startDate and endDate are required");
    }

    const exportData = await accessLogger.exportLogs(
      startDate,
      endDate,
      format
    );

    if (format === "csv") {
      res.set({
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="access-logs-${startDate}-to-${endDate}.csv"`,
      });
      res.send(exportData);
    } else {
      res.json(exportData);
    }
  })
);

// Get memory statistics - ADMIN ONLY
router.get(
  "/memory-stats",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const stats = memoryMonitor.getMemoryStats();
    const report = memoryMonitor.generateReport();

    res.json({
      currentStats: stats,
      report,
      timestamp: new Date().toISOString(),
    });
  })
);

// Update memory limits - ADMIN ONLY
router.put(
  "/memory-limits",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const bodyResult = inputSanitizer.sanitizeObject(req.body);
    const {
      maxFileSize,
      maxConcurrentUploads,
      maxTotalMemoryUsage,
      streamingThreshold,
    } = bodyResult;

    const updates = {};
    if (maxFileSize && Number.isInteger(maxFileSize) && maxFileSize > 0) {
      updates.maxFileSize = maxFileSize;
    }
    if (
      maxConcurrentUploads &&
      Number.isInteger(maxConcurrentUploads) &&
      maxConcurrentUploads > 0
    ) {
      updates.maxConcurrentUploads = maxConcurrentUploads;
    }
    if (
      maxTotalMemoryUsage &&
      Number.isInteger(maxTotalMemoryUsage) &&
      maxTotalMemoryUsage > 0
    ) {
      updates.maxTotalMemoryUsage = maxTotalMemoryUsage;
    }
    if (
      streamingThreshold &&
      Number.isInteger(streamingThreshold) &&
      streamingThreshold > 0
    ) {
      updates.streamingThreshold = streamingThreshold;
    }

    if (Object.keys(updates).length === 0) {
      throw commonErrors.badRequest("No valid updates provided");
    }

    memoryMonitor.updateLimits(updates);

    res.json({
      message: "Memory limits updated successfully",
      updates,
      currentLimits: memoryMonitor.limits,
    });
  })
);

// Get virus scanner status - ADMIN ONLY
router.get(
  "/virus-scanner/status",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const healthStatus = await virusScanner.getHealthStatus();

    res.json({
      health: healthStatus,
      timestamp: new Date().toISOString(),
    });
  })
);

// Test virus scanner - ADMIN ONLY
router.post(
  "/virus-scanner/test",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const testFile = Buffer.from("This is a test file for virus scanning");
    const testFileName = "test-file.txt";

    const result = await virusScanner.scanFile(testFile, testFileName);

    res.json({
      message: "Virus scanner test completed",
      result,
      timestamp: new Date().toISOString(),
    });
  })
);

// Create backup - ADMIN ONLY
router.post(
  "/backup/create",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const bodyResult = inputSanitizer.sanitizeObject(req.body);
    const { type = "full", since } = bodyResult;

    let backupResult;
    if (type === "incremental" && since) {
      backupResult = await backupRecovery.createIncrementalBackup(since);
    } else {
      backupResult = await backupRecovery.createFullBackup();
    }

    if (!backupResult) {
      return res.json({
        message: "No backup created - no changes since last backup",
        type: "incremental",
        since,
      });
    }

    res.json({
      message: "Backup created successfully",
      backup: backupResult,
    });
  })
);

// List backups - ADMIN ONLY
router.get(
  "/backup/list",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const backups = await backupRecovery.listBackups();

    res.json({
      backups,
      count: backups.length,
      timestamp: new Date().toISOString(),
    });
  })
);

// Restore from backup - ADMIN ONLY
router.post(
  "/backup/restore/:backupId",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { backupId } = req.params;
    const sanitizedBackupId = inputSanitizer.sanitizeText(backupId, 50);

    if (!sanitizedBackupId) {
      throw commonErrors.badRequest("Invalid backup ID");
    }

    const restoreResult = await backupRecovery.restoreFromBackup(
      sanitizedBackupId
    );

    res.json({
      message: "Restore completed",
      result: restoreResult,
    });
  })
);

// Get network timeout statistics - ADMIN ONLY
router.get(
  "/network/timeout-stats",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const activeSessions = networkTimeoutHandler.getActiveSessions();
    const timeoutSettings = networkTimeoutHandler.getTimeoutSettings();

    res.json({
      activeSessions,
      sessionCount: activeSessions.length,
      timeoutSettings,
      timestamp: new Date().toISOString(),
    });
  })
);

// Update timeout settings - ADMIN ONLY
router.put(
  "/network/timeout-settings",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const bodyResult = inputSanitizer.sanitizeObject(req.body);
    const {
      connectionTimeout,
      uploadTimeout,
      chunkTimeout,
      maxRetries,
      retryDelay,
    } = bodyResult;

    const updates = {};
    if (
      connectionTimeout &&
      Number.isInteger(connectionTimeout) &&
      connectionTimeout > 0
    ) {
      updates.connectionTimeout = connectionTimeout;
    }
    if (uploadTimeout && Number.isInteger(uploadTimeout) && uploadTimeout > 0) {
      updates.uploadTimeout = uploadTimeout;
    }
    if (chunkTimeout && Number.isInteger(chunkTimeout) && chunkTimeout > 0) {
      updates.chunkTimeout = chunkTimeout;
    }
    if (maxRetries && Number.isInteger(maxRetries) && maxRetries >= 0) {
      updates.maxRetries = maxRetries;
    }
    if (retryDelay && Number.isInteger(retryDelay) && retryDelay > 0) {
      updates.retryDelay = retryDelay;
    }

    if (Object.keys(updates).length === 0) {
      throw commonErrors.badRequest("No valid updates provided");
    }

    networkTimeoutHandler.updateTimeoutSettings(updates);

    res.json({
      message: "Timeout settings updated successfully",
      updates,
      currentSettings: networkTimeoutHandler.getTimeoutSettings(),
    });
  })
);

// Get input sanitizer statistics - ADMIN ONLY
router.get(
  "/security/sanitizer-stats",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const stats = inputSanitizer.getStats();

    res.json({
      sanitizerStats: stats,
      timestamp: new Date().toISOString(),
    });
  })
);

// System health check - ADMIN ONLY
router.get(
  "/health/detailed",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const memoryStats = memoryMonitor.getMemoryStats();
    const virusScannerHealth = await virusScanner.getHealthStatus();
    const backupList = await backupRecovery.listBackups();
    const activeSessions = networkTimeoutHandler.getActiveSessions();

    const health = {
      timestamp: new Date().toISOString(),
      memory: {
        status: memoryStats.system.percentage < 90 ? "healthy" : "warning",
        usage: memoryStats.system.percentage.toFixed(2) + "%",
        activeUploads: memoryStats.uploads.active,
      },
      virusScanner: {
        status: Object.values(virusScannerHealth.scanners).some(
          (s) => s.available
        )
          ? "healthy"
          : "warning",
        availableScanners: Object.entries(virusScannerHealth.scanners)
          .filter(([_, scanner]) => scanner.available)
          .map(([name, _]) => name),
      },
      backup: {
        status: backupList.length > 0 ? "healthy" : "warning",
        lastBackup:
          backupList.length > 0
            ? backupList.sort(
                (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
              )[0].timestamp
            : null,
        totalBackups: backupList.length,
      },
      network: {
        status: activeSessions.length < 10 ? "healthy" : "warning",
        activeSessions: activeSessions.length,
        failedSessions: activeSessions.filter((s) => s.status === "failed")
          .length,
      },
      overall: "healthy", // This would be calculated based on individual component health
    };

    // Determine overall health
    const componentStatuses = [
      health.memory.status,
      health.virusScanner.status,
      health.backup.status,
      health.network.status,
    ];
    if (componentStatuses.includes("error")) {
      health.overall = "error";
    } else if (componentStatuses.includes("warning")) {
      health.overall = "warning";
    }

    res.json(health);
  })
);

module.exports = router;
