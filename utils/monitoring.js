const config = require('../config');
const { logger } = require('./logger');

class HealthMonitor {
  constructor() {
    this.metrics = {
      uptime: process.uptime(),
      requests: 0,
      errors: 0,
      uploads: 0,
      processingJobs: 0,
      memoryUsage: process.memoryUsage(),
      lastHealthCheck: new Date().toISOString()
    };
    
    this.startHealthChecks();
  }

  // Increment request counter
  recordRequest() {
    this.metrics.requests++;
  }

  // Increment error counter
  recordError() {
    this.metrics.errors++;
  }

  // Increment upload counter
  recordUpload() {
    this.metrics.uploads++;
  }

  // Record processing job
  recordProcessingJob() {
    this.metrics.processingJobs++;
  }

  // Get current health status
  getHealthStatus() {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(memUsage.external / 1024 / 1024) + 'MB'
      },
      metrics: {
        totalRequests: this.metrics.requests,
        totalErrors: this.metrics.errors,
        totalUploads: this.metrics.uploads,
        activeProcessingJobs: this.metrics.processingJobs,
        errorRate: this.metrics.requests > 0 ? 
          ((this.metrics.errors / this.metrics.requests) * 100).toFixed(2) + '%' : '0%'
      },
      environment: config.server.env,
      nodeVersion: process.version
    };
  }

  // Start periodic health checks
  startHealthChecks() {
    if (!config.monitoring.metricsEnabled) return;

    setInterval(() => {
      this.performHealthCheck();
    }, config.monitoring.healthCheckInterval);
  }

  // Perform health check
  performHealthCheck() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    
    // Update metrics
    this.metrics.memoryUsage = memUsage;
    this.metrics.lastHealthCheck = new Date().toISOString();
    
    // Log warnings for high memory usage
    if (heapUsedMB > 500) { // 500MB threshold
      logger.warn('High memory usage detected', {
        heapUsed: `${Math.round(heapUsedMB)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
      });
    }
    
    // Log health status periodically
    if (config.server.isDevelopment) {
      logger.info('Health check', this.getHealthStatus());
    }
  }

  // Get detailed metrics
  getMetrics() {
    return {
      ...this.metrics,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      timestamp: new Date().toISOString()
    };
  }
}

// Performance monitoring middleware
const performanceMonitor = (req, res, next) => {
  const start = process.hrtime.bigint();
  
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    
    // Log slow requests
    if (duration > 1000) { // 1 second threshold
      logger.warn('Slow request detected', {
        method: req.method,
        url: req.url,
        duration: `${duration.toFixed(2)}ms`,
        status: res.statusCode
      });
    }
    
    // Record metrics
    healthMonitor.recordRequest();
    if (res.statusCode >= 400) {
      healthMonitor.recordError();
    }
    if (req.path.includes('/upload') && req.method === 'POST') {
      healthMonitor.recordUpload();
    }
  });
  
  next();
};

// Create global health monitor instance
const healthMonitor = new HealthMonitor();

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  // Stop accepting new requests
  process.exit(0);
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  process.exit(1);
});

module.exports = {
  healthMonitor,
  performanceMonitor,
  gracefulShutdown
};