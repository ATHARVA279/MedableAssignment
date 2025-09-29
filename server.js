const express = require('express');
const cors = require('cors');
const path = require('path');

// Import configuration
const config = require('./config');

// Global error handlers to prevent crashes from unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  const { logger } = require('./utils/logger');
  logger.error('Unhandled promise rejection', {
    reason: reason?.message || reason,
    promise: {
      exception: reason
    }
  });
  console.error('🚨 Unhandled Promise Rejection:', reason);
  // Don't exit the process, just log the error
});

process.on('uncaughtException', (error) => {
  const { logger } = require('./utils/logger');
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack
  });
  console.error('🚨 Uncaught Exception:', error);
  // For uncaught exceptions, we should exit after logging
  process.exit(1);
});

// Import database connection
const { dbConnection } = require('./config/db');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { initializeStorage } = require('./utils/fileStorage');
const { apiLimiter, uploadLimiter, authLimiter } = require('./middleware/rateLimiter');
const { securityHeaders, sanitizeRequest, requestLogger } = require('./middleware/security');
const { performanceMonitor, healthMonitor } = require('./utils/monitoring');
const { logger } = require('./utils/logger');

// Import production security middleware
const {
  strictApiLimiter,
  strictUploadLimiter,
  strictAuthLimiter,
  productionHelmet,
  memoryProtection,
  uploadSecurity,
  suspiciousActivityDetection
} = require('./middleware/productionSecurity');

// Import routes
const authRoutes = require('./routes/auth');
const uploadRoutes = require('./routes/upload');
const processingLogsRoutes = require('./routes/processing-logs');
const archiveRoutes = require('./routes/archive');
const sharingRoutes = require('./routes/sharing');
const versionsRoutes = require('./routes/versions');
const batchRoutes = require('./routes/batch');
const quotasRoutes = require('./routes/quotas');
const virusScanRoutes = require('./routes/virusScan');

const app = express();
const PORT = config.server.port;

// Initialize database connection
dbConnection.connect().catch(error => {
  logger.error('Failed to initialize database connection', { error: error.message });
  console.error('❌ Database initialization failed:', error.message);
  process.exit(1);
});

// Initialize storage system
(async () => {
  try {
    const { testCloudinaryConnection, isCloudinaryConfigured } = require('./utils/cloudinaryStorage');
    
    if (isCloudinaryConfigured()) {
      console.log('🔄 Testing Cloudinary connection...');
      const connectionTest = await testCloudinaryConnection();
      
      if (connectionTest.success) {
        console.log('✅ Cloudinary connection successful');
        logger.info('Cloudinary connection established');
      } else {
        console.log('❌ Cloudinary connection failed:', connectionTest.error);
        logger.error('Cloudinary connection failed during startup', { error: connectionTest.error });
      }
    } else {
      console.log('⚠️  Cloudinary credentials not configured properly');
      logger.warn('Cloudinary credentials missing or incomplete');
    }
  } catch (error) {
    console.log('❌ Failed to test Cloudinary connection:', error.message);
    logger.error('Cloudinary connection test failed during startup', { error: error.message });
  }
})();
initializeStorage().catch(error => {
  logger.error('Failed to initialize storage system', { error: error.message });
  console.error('❌ Storage initialization failed:', error.message);
  process.exit(1);
});

// Security middleware (production)
if (config.server.isProduction) {
  app.use(productionHelmet);
  app.use(memoryProtection);
  app.use(suspiciousActivityDetection);
  app.set('trust proxy', 1); // Trust first proxy
} else {
  app.use(securityHeaders);
}

// Core middleware
app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// Note: No longer serving /uploads directory - files are now served from Cloudinary

// Monitoring and logging
app.use(performanceMonitor);
app.use(requestLogger);

// Security middleware
app.use(sanitizeRequest);

// Rate limiting (use strict limits in production)
if (config.server.isProduction) {
  app.use('/api', strictApiLimiter);
  app.use('/api/auth', strictAuthLimiter);
  app.use('/api/upload', strictUploadLimiter);
  app.use('/api/upload', uploadSecurity);
} else {
  app.use('/api', apiLimiter);
  app.use('/api/auth', authLimiter);
  app.use('/api/upload', uploadLimiter);
}

// Custom headers for puzzle hints
app.use((req, res, next) => {
  res.set({
    'X-Upload-Limit': '10MB',
    'X-Hidden-Metadata': 'check_file_processing_logs_endpoint',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  next();
});

// Import admin routes
const adminRoutes = require('./routes/admin');
const queueRoutes = require('./routes/queue');

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/processing-logs', processingLogsRoutes);
app.use('/api/archive', archiveRoutes);
app.use('/api/sharing', sharingRoutes);
app.use('/api/versions', versionsRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/quotas', quotasRoutes);
app.use('/api/virus-scan', virusScanRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/queue', queueRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  const healthStatus = healthMonitor.getHealthStatus();
  
  // Add MongoDB health check
  const dbHealth = await dbConnection.healthCheck();
  healthStatus.database = {
    mongodb: dbHealth
  };
  
  res.json(healthStatus);
});

// Metrics endpoint (development only)
if (config.development.enableTestEndpoints) {
  app.get('/metrics', (req, res) => {
    res.json(healthMonitor.getMetrics());
  });
}

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve the frontend app for any non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use(errorHandler);

// Global error handlers
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  console.error('❌ Uncaught Exception:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise
  });
  console.error('❌ Unhandled Promise Rejection:', reason?.message || reason);
  // Don't exit in development, just log the error
  if (config.server.isProduction) {
    process.exit(1);
  }
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  console.log('🔄 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  console.log('🔄 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

app.listen(PORT, config.server.host, () => {
  logger.info('Server started', {
    port: PORT,
    host: config.server.host,
    environment: config.server.env,
    nodeVersion: process.version
  });
  
  console.log(`📁 Assessment 4: File Processing API running on http://${config.server.host}:${PORT}`);
  console.log(`📋 View instructions: http://${config.server.host}:${PORT}`);
  console.log(`🧩 Multi-layered puzzles and file security challenges await!`);
  console.log(`🔧 Environment: ${config.server.env}`);
  console.log(`☁️  Storage: ${config.storage.type.toUpperCase()}`);
  
  if (config.server.isProduction) {
    console.log('🔒 Production mode: Security features enabled');
  } else {
    console.log('🛠️  Development mode: Debug features enabled');
  }
});
