const express = require("express");
const cors = require("cors");
const path = require("path");

const config = require("./config");

const { dbConnection } = require("./config/db");

const { errorHandler } = require("./middleware/errorHandler");
const {
  apiLimiter,
  uploadLimiter,
  authLimiter,
} = require("./middleware/rateLimiter");
const {
  securityHeaders,
  requestLogger,
} = require("./middleware/security");
const {
  testCloudinaryConnection,
  isCloudinaryConfigured,
} = require("./utils/cloudinaryStorage");
const { performanceMonitor, healthMonitor } = require("./utils/monitoring");
const { logger } = require("./utils/logger");

const authRoutes = require("./routes/auth");
const uploadRoutes = require("./routes/upload");
const processingLogsRoutes = require("./routes/processing-logs");
const archiveRoutes = require("./routes/archive");
const sharingRoutes = require("./routes/sharing");
const versionsRoutes = require("./routes/versions");
const batchRoutes = require("./routes/batch");
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
    if (isCloudinaryConfigured()) {
      const connectionTest = await testCloudinaryConnection();

      if (connectionTest.success) {
        console.log("Cloudinary connection successful");
      } else {
        console.log("Cloudinary connection failed:", connectionTest.error);
      }
    } else {
      console.log("Cloudinary credentials not configured properly");
    }
  } catch (error) {
    console.log("Failed to test Cloudinary connection:", error.message);
  }
})();

app.use(securityHeaders);

app.use(
  cors({
    origin: config.cors.origin,
    credentials: config.cors.credentials,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(performanceMonitor);
app.use(requestLogger);

app.use("/api", apiLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/upload", uploadLimiter);

const queueRoutes = require("./routes/queue");

app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/processing-logs", processingLogsRoutes);
app.use("/api/archive", archiveRoutes);
app.use("/api/sharing", sharingRoutes);
app.use("/api/versions", versionsRoutes);
app.use("/api/batch", batchRoutes);
app.use("/api/virus-scan", virusScanRoutes);
app.use("/api/queue", queueRoutes);

app.get("/health", async (req, res) => {
  const healthStatus = healthMonitor.getHealthStatus();

  const dbHealth = await dbConnection.healthCheck();
  healthStatus.database = {
    mongodb: dbHealth,
  };

  res.json(healthStatus);
});

app.use(errorHandler);

const HOST =
  process.env.NODE_ENV === "production" ? "0.0.0.0" : config.server.host;

app.listen(PORT, HOST, () => {
  console.log(`Server started on http://${HOST}:${PORT}`);
  console.log(`Multi-layered puzzles and file security challenges await!`);
  console.log(`Environment: ${config.server.env}`);
  console.log(`Storage: ${config.storage.type.toUpperCase()}`);
});
