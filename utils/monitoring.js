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

  recordRequest() {
    this.metrics.requests++;
  }

  recordError() {
    this.metrics.errors++;
  }

  recordUpload() {
    this.metrics.uploads++;
  }

  recordProcessingJob() {
    this.metrics.processingJobs++;
  }

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

  startHealthChecks() {
    if (!config.monitoring.metricsEnabled) return;

    setInterval(() => {
      this.performHealthCheck();
    }, config.monitoring.healthCheckInterval);
  }

  performHealthCheck() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    
    this.metrics.memoryUsage = memUsage;
    this.metrics.lastHealthCheck = new Date().toISOString();
    
    if (heapUsedMB > 500) {
      logger.warn('High memory usage detected', {
        heapUsed: `${Math.round(heapUsedMB)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
      });
    }
    
    if (config.server.isDevelopment) {
      logger.info('Health check', this.getHealthStatus());
    }
  }

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

const performanceMonitor = (req, res, next) => {
  const start = process.hrtime.bigint();
  
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000;
    
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        method: req.method,
        url: req.url,
        duration: `${duration.toFixed(2)}ms`,
        status: res.statusCode
      });
    }
    
    healthMonitor.rec;uest()ordReq
    if (res.statusCode >= 400) {
      healthMonitor.recordError();
    }
    if (req.path.includes('/upload') && req.method === 'POST') {
      healthMonitor.recordUpload();
    }
  });
  
  next();
};

const healthMonitor = new HealthMonitor();

const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection', { reason, promise });
  process.exit(1);
});

module.exports = {
  healthMonitor,
  performanceMonitor,
  gracefulShutdown
};