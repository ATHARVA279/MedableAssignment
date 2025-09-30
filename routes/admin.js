const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const { asyncHandler, commonErrors } = require("../middleware/errorHandler");
const { memoryMonitor } = require("../utils/memoryMonitor");
const { virusScanner } = require("../utils/virusScanner");
const { backupRecovery } = require("../utils/backupRecovery");
const { networkTimeoutHandler } = require("../utils/networkTimeout");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

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
      overall: "healthy",
    };

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
