const path = require("path");

require("dotenv").config();

const config = {
  server: {
    port: parseInt(process.env.PORT) || 8888,
    host: process.env.HOST || "localhost",
    env: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    isDevelopment: process.env.NODE_ENV === "development",
  },

  security: {
    jwtSecret: process.env.JWT_SECRET || "file-upload-secret-2024",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "24h",
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 10,
    encryptionKey: process.env.ENCRYPTION_KEY || "default-encryption-key",
    virusTotalApiKey: process.env.VIRUSTOTAL_API_KEY,
  },

  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024,
    allowedMimeTypes: process.env.ALLOWED_MIME_TYPES?.split(",") || [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "text/csv",
    ],
  },

  database: {
    url: process.env.DATABASE_URL || "sqlite:./dev.db",
    redis: process.env.REDIS_URL || "redis://localhost:6379",
    mongodb: {
      uri: process.env.MONGO_URI || "mongodb://localhost:27017/file_uploads",
      options: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        maxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE) || 10,
        serverSelectionTimeoutMS:
          parseInt(process.env.MONGO_SERVER_SELECTION_TIMEOUT) || 5000,
        socketTimeoutMS: parseInt(process.env.MONGO_SOCKET_TIMEOUT) || 45000,
      },
    },
  },

  storage: {
    type: process.env.STORAGE_TYPE || "cloudinary",
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    },
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || "us-east-1",
      bucket: process.env.AWS_S3_BUCKET,
    },
  },

  puzzle: {
    adminCode: process.env.PUZZLE_ADMIN_CODE || "PROC_LOGS_ADMIN_2024",
    systemKey: process.env.PUZZLE_SYSTEM_KEY || "system-processing-key-2024",
    archiveKey: process.env.PUZZLE_ARCHIVE_KEY || "ARCHIVE_MASTER_2024",
    enabled: process.env.ENABLE_PUZZLE_ENDPOINTS !== "false",
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    uploadMax: parseInt(process.env.RATE_LIMIT_UPLOAD_MAX) || 10,
  },

  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "./logs/app.log",
    errorFile: process.env.ERROR_LOG_FILE || "./logs/error.log",
  },

  email: {
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    adminEmail: process.env.ADMIN_EMAIL,
  },

  monitoring: {
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000,
    metricsEnabled: process.env.METRICS_ENABLED === "true",
    sentryDsn: process.env.SENTRY_DSN,
  },

  processing: {
    queueConcurrency: parseInt(process.env.PROCESSING_QUEUE_CONCURRENCY) || 5,
    thumbnailQuality: parseInt(process.env.THUMBNAIL_QUALITY) || 80,
    thumbnailSize: parseInt(process.env.THUMBNAIL_SIZE) || 200,
    pdfTimeout: parseInt(process.env.PDF_PROCESSING_TIMEOUT) || 30000,
    csvMaxRows: parseInt(process.env.CSV_MAX_ROWS) || 100000,
  },

  cleanup: {
    interval: parseInt(process.env.CLEANUP_INTERVAL) || 60 * 60 * 1000,
    tempFileMaxAge:
      parseInt(process.env.TEMP_FILE_MAX_AGE) || 24 * 60 * 60 * 1000,
    processingJobMaxAge:
      parseInt(process.env.PROCESSING_JOB_MAX_AGE) || 7 * 24 * 60 * 60 * 1000,
  },

  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    credentials: process.env.CORS_CREDENTIALS === "true",
  },

  ssl: {
    enabled: process.env.SSL_ENABLED === "true",
    certPath: process.env.SSL_CERT_PATH,
    keyPath: process.env.SSL_KEY_PATH,
  },

  development: {
    enableTestEndpoints: process.env.ENABLE_TEST_ENDPOINTS === "true",
    mockVirusScan: process.env.MOCK_VIRUS_SCAN !== "false",
  },

  versioning: {
    enabled: process.env.ENABLE_FILE_VERSIONING !== "false",
    maxVersionsPerFile: parseInt(process.env.MAX_VERSIONS_PER_FILE) || 10,
    autoCleanupOldVersions: process.env.AUTO_CLEANUP_OLD_VERSIONS === "true",
  },

  batchProcessing: {
    enabled: process.env.ENABLE_BATCH_PROCESSING !== "false",
    maxFilesPerBatch: parseInt(process.env.MAX_FILES_PER_BATCH) || 10,
    defaultConcurrency: parseInt(process.env.DEFAULT_BATCH_CONCURRENCY) || 3,
    maxConcurrency: parseInt(process.env.MAX_BATCH_CONCURRENCY) || 5,
  },

  quotas: {
    enabled: process.env.ENABLE_STORAGE_QUOTAS !== "false",
    defaultUserQuota:
      parseInt(process.env.DEFAULT_USER_QUOTA) || 100 * 1024 * 1024,
    defaultAdminQuota:
      parseInt(process.env.DEFAULT_ADMIN_QUOTA) || 1024 * 1024 * 1024,
    quotaCheckInterval:
      parseInt(process.env.QUOTA_CHECK_INTERVAL) || 60 * 60 * 1000,
  },

  encryption: {
    enabled: process.env.ENABLE_FILE_ENCRYPTION === "true",
    algorithm: process.env.ENCRYPTION_ALGORITHM || "aes-256-gcm",
    keyRotationInterval:
      parseInt(process.env.KEY_ROTATION_INTERVAL) || 30 * 24 * 60 * 60 * 1000,
  },
};

if (config.server.isProduction) {
  const requiredEnvVars = ["JWT_SECRET", "DATABASE_URL", "ENCRYPTION_KEY"];

  if (config.storage.type === "cloudinary") {
    requiredEnvVars.push(
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET"
    );
  }

  requiredEnvVars.push("MONGO_URI");

  const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);

  if (missing.length > 0) {
    console.error("Missing required environment variables for production:");
    missing.forEach((envVar) => console.error(`   - ${envVar}`));
    process.exit(1);
  }

  if (config.security.jwtSecret === "file-upload-secret-2024") 
  if (config.security.jwtSecret === "file-upload-secret-2024") {
    console.warn("WARNING: Using default JWT secret in production!");
  }
}

module.exports = config;
