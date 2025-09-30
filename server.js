const express = require("express");
const cors = require("cors");
const path = require("path");

const config = require("./config");

process.on("unhandledRejection", (reason, promise) => {
  const { logger } = require("./utils/logger");
  logger.error("Unhandled promise rejection", {
    reason: reason?.message || reason,
    promise: {
      exception: reason,
    },
  });
  console.error("Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  const { logger } = require("./utils/logger");
  logger.error("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

const { dbConnection } = require("./config/db");

const { errorHandler } = require("./middleware/errorHandler");
const { initializeStorage } = require("./utils/fileStorage");
const {
  apiLimiter,
  uploadLimiter,
  authLimiter,
} = require("./middleware/rateLimiter");
const {
  securityHeaders,
  sanitizeRequest,
  requestLogger,
} = require("./middleware/security");
const { performanceMonitor, healthMonitor } = require("./utils/monitoring");
const { logger } = require("./utils/logger");

const {
  strictApiLimiter,
  strictUploadLimiter,
  strictAuthLimiter,
  productionHelmet,
  memoryProtection,
  uploadSecurity,
  suspiciousActivityDetection,
} = require("./middleware/productionSecurity");

const authRoutes = require("./routes/auth");
const uploadRoutes = require("./routes/upload");
const processingLogsRoutes = require("./routes/processing-logs");
const archiveRoutes = require("./routes/archive");
const sharingRoutes = require("./routes/sharing");
const versionsRoutes = require("./routes/versions");
const batchRoutes = require("./routes/batch");
const quotasRoutes = require("./routes/quotas");
const virusScanRoutes = require("./routes/virusScan");

const app = express();
const PORT = config.server.port;

dbConnection.connect().catch((error) => {
  logger.error("Failed to initialize database connection", {
    error: error.message,
  });
  console.error("Database initialization failed:", error.message);
  process.exit(1);
});

(async () => {
  try {
    const {
      testCloudinaryConnection,
      isCloudinaryConfigured,
    } = require("./utils/cloudinaryStorage");

    if (isCloudinaryConfigured()) {
      console.log("Testing Cloudinary connection...");
      const connectionTest = await testCloudinaryConnection();

      if (connectionTest.success) {
        console.log("Cloudinary connection successful");
        logger.info("Cloudinary connection established");
      } else {
        console.log("Cloudinary connection failed:", connectionTest.error);
        logger.error("Cloudinary connection failed during startup", {
          error: connectionTest.error,
        });
      }
    } else {
      console.log("Cloudinary credentials not configured properly");
      logger.warn("Cloudinary credentials missing or incomplete");
    }
  } catch (error) {
    console.log("Failed to test Cloudinary connection:", error.message);
    logger.error("Cloudinary connection test failed during startup", {
      error: error.message,
    });
  }
})();
initializeStorage().catch((error) => {
  logger.error("Failed to initialize storage system", { error: error.message });
  console.error("Storage initialization failed:", error.message);
  process.exit(1);
});

if (config.server.isProduction) {
  app.use(productionHelmet);
  app.use(memoryProtection);
  app.use(suspiciousActivityDetection);
  app.set("trust proxy", 1);
} else {
  app.use(securityHeaders);
}

app.use(
  cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(performanceMonitor);
app.use(requestLogger);

app.use(sanitizeRequest);

if (config.server.isProduction) {
  app.use("/api", strictApiLimiter);
  app.use("/api/auth", strictAuthLimiter);
  app.use("/api/upload", strictUploadLimiter);
  app.use("/api/upload", uploadSecurity);
} else {
  app.use("/api", apiLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/api/upload", uploadLimiter);
}

app.use((req, res, next) => {
  res.set({
    "X-Upload-Limit": "10MB",
    "X-Hidden-Metadata": "check_file_processing_logs_endpoint",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  });
  next();
});

const adminRoutes = require("./routes/admin");
const queueRoutes = require("./routes/queue");

app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/processing-logs", processingLogsRoutes);
app.use("/api/archive", archiveRoutes);
app.use("/api/sharing", sharingRoutes);
app.use("/api/versions", versionsRoutes);
app.use("/api/batch", batchRoutes);
app.use("/api/quotas", quotasRoutes);
app.use("/api/virus-scan", virusScanRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/queue", queueRoutes);

app.get("/health", async (req, res) => {
  const healthStatus = healthMonitor.getHealthStatus();

  const dbHealth = await dbConnection.healthCheck();
  healthStatus.database = {
    mongodb: dbHealth,
  };

  res.json(healthStatus);
});

app.get("/memory-status", (req, res) => {
  const { memoryMonitor } = require("./utils/memoryMonitor");
  const memoryStats = memoryMonitor.getMemoryStats();
  res.json({
    status: "ok",
    memory: memoryStats,
    canAcceptUploads: memoryStats.system.percentage < 93,
    message:
      memoryStats.system.percentage > 93
        ? "System memory usage too high for new uploads"
        : "System ready for uploads",
  });
});

if (config.development.enableTestEndpoints) {
  app.get("/metrics", (req, res) => {
    res.json(healthMonitor.getMetrics());
  });
}

app.get("/", (req, res) => {
  res.json({
    message: "File Processing API - Assessment 4",
    status: "running",
    environment: config.server.env,
    endpoints: {
      health: "/health",
      upload: "/api/upload",
      processingLogs: "/api/processing-logs",
      archive: "/api/archive",
    },
  });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();

  res.status(404).json({
    error: "Page not found",
    message:
      "This is a File Processing API. Use /api endpoints or /health for status.",
  });
});

app.use("*", (req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

app.use(errorHandler);
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", {
    error: error.message,
    stack: error.stack,
  });
  console.error("Uncaught Exception:", error.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection", {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise,
  });
  console.error("Unhandled Promise Rejection:", reason?.message || reason);
  if (config.server.isProduction) {
    process.exit(1);
  }
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");
  console.log("SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");
  console.log("SIGINT received, shutting down gracefully...");
  process.exit(0);
});

const HOST =
  process.env.NODE_ENV === "production" ? "0.0.0.0" : config.server.host;

app.listen(PORT, HOST, () => {
  logger.info("Server started", {
    port: PORT,
    host: HOST,
    environment: config.server.env,
    nodeVersion: process.version,
  });

  console.log(
    `Assessment 4: File Processing API running on http://${HOST}:${PORT}`
  );
  console.log(`View instructions: http://${HOST}:${PORT}`);
  console.log(`Multi-layered puzzles and file security challenges await!`);
  console.log(`Environment: ${config.server.env}`);
  console.log(`Storage: ${config.storage.type.toUpperCase()}`);
});
