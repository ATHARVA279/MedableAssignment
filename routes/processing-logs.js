const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { optionalAuth } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/errorHandler");

const router = express.Router();

const processingLogs = [
  {
    id: "log-001",
    timestamp: new Date("2024-01-01T10:00:00Z").toISOString(),
    fileId: "file-001",
    operation: "pdf-processing",
    status: "completed",
    duration: 2340,
    details: {
      extractedText: "CONFIDENTIAL: Company Q4 earnings report...",
      metadata: { author: "John Smith", createdBy: "Adobe PDF", pages: 15 },
      processingServer: "server-us-east-1",
    },
    error: null,
  },
  {
    id: "log-002",
    timestamp: new Date("2024-01-02T14:30:00Z").toISOString(),
    fileId: "file-002",
    operation: "csv-analysis",
    status: "completed",
    duration: 1200,
    details: {
      rowCount: 50000,
      sensitiveColumns: ["email", "ssn", "salary"],
      dataPreview: {
        email: "ceo@company.com",
        ssn: "123-45-6789",
        salary: 250000,
      },
      processingServer: "server-eu-west-1",
    },
    error: null,
  },
];

// Base64 encoded secret message
const SECRET_ARCHIVE_HINT =
  "VGhlIGZpbmFsIHNlY3JldCBpcyBoaWRkZW4gaW4gdGhlIGFyY2hpdmUgZG93bmxvYWQgZW5kcG9pbnQgd2l0aCBrZXk6IEFSR0hJVkVfTUFTVEVSXzIwMjQ=";

const JWT_SECRET = "file-upload-secret-2024";
const ADMIN_ACCESS_CODE = "PROC_LOGS_ADMIN_2024";
const SYSTEM_API_KEY = "system-processing-key-2024";

router.get(
  "/",
  optionalAuth,
  asyncHandler(async (req, res) => {
    const authHeader = req.get("authorization");
    const systemKey = req.get("x-system-key");
    const accessCode = req.query.access;
    const logLevel = req.query.level || "basic";

    let hasAccess = false;
    let accessLevel = "basic";
    let currentUser = null;

    if (systemKey === SYSTEM_API_KEY) {
      hasAccess = true;
      accessLevel = "system";
    } else if (accessCode === ADMIN_ACCESS_CODE) {
      hasAccess = true;
      accessLevel = "admin";
    } else if (req.user) {
      currentUser = req.user;
      hasAccess = true;
      accessLevel = currentUser.role === "admin" ? "admin" : "user";
    }

    if (!hasAccess) {
      return res.status(403).json({
        error: "Access denied to processing logs",
        hints: [
          "Try with valid JWT token for basic access",
          "Admin access code in query parameter",
          "System API key in X-System-Key header",
          "Check the header hints...",
        ],
      });
    }

    let filteredLogs = [...processingLogs];
    let responseData = {
      accessLevel,
      logLevel,
      logs: [],
      summary: {},
      systemInfo: {},
    };

    if (accessLevel === "user") {
      filteredLogs = filteredLogs.filter((log) => !log.classified);
    } else if (accessLevel === "admin") {
      filteredLogs = filteredLogs.filter((log) => !log.classified);
    }

    if (logLevel === "basic") {
      responseData.logs = filteredLogs.map((log) => ({
        id: log.id,
        timestamp: log.timestamp,
        fileId: log.fileId,
        operation: log.operation,
        status: log.status,
        duration: log.duration,
      }));
    } else if (logLevel === "detailed" && accessLevel !== "user") {
      responseData.logs = filteredLogs.map((log) => ({
        id: log.id,
        timestamp: log.timestamp,
        fileId: log.fileId,
        operation: log.operation,
        status: log.status,
        duration: log.duration,
        error: log.error,
        details: log.details
          ? {
              ...log.details,
              ...(accessLevel === "admin" && log.details.sensitiveColumns
                ? {
                    sensitiveColumns: "[REDACTED]",
                    dataPreview: "[REDACTED]",
                  }
                : {}),
            }
          : null,
      }));
    } else if (logLevel === "full" && accessLevel === "system") {
      responseData.logs = filteredLogs.map((log) => ({
        ...log,
        internalNotes: `Processing on ${
          log.details?.processingServer || "unknown"
        }`,
      }));
    }

    responseData.summary = {
      totalLogs: filteredLogs.length,
      completedOperations: filteredLogs.filter((l) => l.status === "completed")
        .length,
      failedOperations: filteredLogs.filter((l) => l.status === "failed")
        .length,
      averageProcessingTime: Math.round(
        filteredLogs.reduce((sum, l) => sum + l.duration, 0) /
          filteredLogs.length
      ),
      operationTypes: [...new Set(filteredLogs.map((l) => l.operation))],
    };

    if (accessLevel === "admin" || accessLevel === "system") {
      responseData.systemInfo = {
        processingServers: [
          "server-us-east-1",
          "server-eu-west-1",
          "server-us-west-2",
          "server-secure-vault",
        ],
        queueStatus: {
          pending: 3,
          processing: 1,
          completed: 156,
          failed: 8,
        },
        systemHealth: "operational",
      };
    }

    if (accessLevel === "system") {
      responseData.secretHint = SECRET_ARCHIVE_HINT;
      responseData.decodeHint = "This is Base64 encoded";
    }

    const startDate = req.query.start_date;
    const endDate = req.query.end_date;
    if (startDate && endDate) {
      responseData.logs = responseData.logs.filter((log) => {
        const logDate = new Date(log.timestamp);
        return logDate >= new Date(startDate) && logDate <= new Date(endDate);
      });
    }

    res.set({
      "X-Access-Level": accessLevel,
      "X-Log-Count": responseData.logs.length.toString(),
      "X-Processing-Queue": responseData.systemInfo.queueStatus
        ? responseData.systemInfo.queueStatus.pending.toString()
        : "0",
      "Cache-Control": "no-cache",
    });

    res.json(responseData);
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const systemKey = req.get("x-system-key");

    if (systemKey !== SYSTEM_API_KEY) {
      return res
        .status(403)
        .json({ error: "Only system access can add processing logs" });
    }

    const { fileId, operation, status, duration, details, error } = req.body;

    if (!fileId || !operation || !status) {
      return res
        .status(400)
        .json({ error: "Missing required fields: fileId, operation, status" });
    }

    const newLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      fileId,
      operation,
      status,
      duration: duration || 0,
      details: details || null,
      error: error || null,
      classified: false,
    };

    processingLogs.push(newLog);

    res.status(201).json({
      message: "Processing log added successfully",
      logId: newLog.id,
      timestamp: newLog.timestamp,
    });
  })
);

module.exports = router;
