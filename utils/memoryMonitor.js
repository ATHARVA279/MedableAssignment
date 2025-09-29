const { logger } = require('./logger');
const { EventEmitter } = require('events');
class MemoryMonitor extends EventEmitter {
  constructor() {
    super();
    this.thresholds = {
      warning: 0.85,   
      critical: 0.93,  
      emergency: 0.97  
    };
    
    this.limits = {
      maxFileSize: 50 * 1024 * 1024,      
      maxConcurrentUploads: 5,           
      maxTotalMemoryUsage: 200 * 1024 * 1024,
      streamingThreshold: 10 * 1024 * 1024  
    };

    this.activeUploads = new Map();
    this.memoryUsage = {
      current: 0,
      peak: 0,
      uploads: 0
    };

    this.isMonitoring = false;
    this.isCleaningUp = false; 
    this.lastCleanupTime = 0;  
    this.monitoringInterval = null;
  }

  startMonitoring(intervalMs = 5000) {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, intervalMs);

    logger.info('Memory monitoring started', {
      interval: intervalMs,
      thresholds: this.thresholds,
      limits: this.limits
    });
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    logger.info('Memory monitoring stopped');
  }

  checkMemoryUsage() {
    const skipThresholdChecks = this.isCleaningUp;
    
    const memUsage = process.memoryUsage();
    const totalMemory = require('os').totalmem();
    const freeMemory = require('os').freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryPercentage = usedMemory / totalMemory;

    this.memoryUsage.current = memUsage.heapUsed;
    this.memoryUsage.peak = Math.max(this.memoryUsage.peak, memUsage.heapUsed);

    const status = {
      timestamp: new Date().toISOString(),
      heap: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100
      },
      system: {
        total: totalMemory,
        free: freeMemory,
        used: usedMemory,
        percentage: memoryPercentage * 100
      },
      uploads: {
        active: this.activeUploads.size,
        memoryUsed: this.memoryUsage.uploads
      }
    };

    if (!skipThresholdChecks) {
      if (memoryPercentage >= this.thresholds.emergency) {
        this.handleEmergencyMemory(status);
      } else if (memoryPercentage >= this.thresholds.critical) {
        this.handleCriticalMemory(status);
      } else if (memoryPercentage >= this.thresholds.warning) {
        this.handleWarningMemory(status);
      }
    }

    if (Date.now() % 60000 < 5000) { 
      logger.info('Memory status', status);
    }

    return status;
  }

  handleWarningMemory(status) {
    this.emit('memoryWarning', status);
    logger.warn('Memory usage warning', {
      systemPercentage: status.system.percentage.toFixed(2) + '%',
      heapPercentage: status.heap.percentage.toFixed(2) + '%',
      activeUploads: status.uploads.active
    });
  }

  handleCriticalMemory(status) {
    if (this.isCleaningUp) {
      return;
    }

    this.emit('memoryCritical', status);
    logger.error('Critical memory usage detected', {
      systemPercentage: status.system.percentage.toFixed(2) + '%',
      heapPercentage: status.heap.percentage.toFixed(2) + '%',
      activeUploads: status.uploads.active
    });

    this.performMemoryCleanup();
  }

  handleEmergencyMemory(status) {
    if (this.isCleaningUp) {
      return;
    }

    this.emit('memoryEmergency', status);
    logger.error('EMERGENCY: Memory usage critical - taking emergency actions', {
      systemPercentage: status.system.percentage.toFixed(2) + '%',
      heapPercentage: status.heap.percentage.toFixed(2) + '%'
    });

    this.performEmergencyCleanup();
  }

  canAcceptUpload(fileSize, fileName) {
    const currentMemory = this.checkMemoryUsage();
    
    if (fileSize > this.limits.maxFileSize) {
      return {
        allowed: false,
        reason: `File size ${this.formatBytes(fileSize)} exceeds maximum limit of ${this.formatBytes(this.limits.maxFileSize)}`,
        code: 'FILE_TOO_LARGE'
      };
    }

    if (this.activeUploads.size >= this.limits.maxConcurrentUploads) {
      return {
        allowed: false,
        reason: `Maximum concurrent uploads (${this.limits.maxConcurrentUploads}) reached`,
        code: 'TOO_MANY_UPLOADS'
      };
    }

    if (this.memoryUsage.uploads + fileSize > this.limits.maxTotalMemoryUsage) {
      return {
        allowed: false,
        reason: `Upload would exceed memory limit. Current: ${this.formatBytes(this.memoryUsage.uploads)}, Limit: ${this.formatBytes(this.limits.maxTotalMemoryUsage)}`,
        code: 'MEMORY_LIMIT_EXCEEDED'
      };
    }

    if (currentMemory.system.percentage > this.thresholds.critical * 100) {
      return {
        allowed: false,
        reason: 'System memory usage too high for new uploads',
        code: 'SYSTEM_MEMORY_HIGH'
      };
    }

    const useStreaming = fileSize > this.limits.streamingThreshold;

    return {
      allowed: true,
      useStreaming,
      reason: useStreaming ? 'File will be processed using streaming to conserve memory' : 'Upload accepted'
    };
  }

  registerUpload(uploadId, fileSize, fileName) {
    const upload = {
      uploadId,
      fileSize,
      fileName,
      startTime: Date.now(),
      memoryAllocated: fileSize
    };

    this.activeUploads.set(uploadId, upload);
    this.memoryUsage.uploads += fileSize;

    logger.info('Upload registered', {
      uploadId,
      fileName,
      fileSize: this.formatBytes(fileSize),
      totalMemoryUsed: this.formatBytes(this.memoryUsage.uploads),
      activeUploads: this.activeUploads.size
    });

    this.emit('uploadRegistered', upload);
  }

  unregisterUpload(uploadId) {
    const upload = this.activeUploads.get(uploadId);
    if (upload) {
      this.activeUploads.delete(uploadId);
      this.memoryUsage.uploads -= upload.memoryAllocated;

      logger.info('Upload unregistered', {
        uploadId,
        fileName: upload.fileName,
        duration: Date.now() - upload.startTime,
        memoryFreed: this.formatBytes(upload.memoryAllocated),
        remainingMemory: this.formatBytes(this.memoryUsage.uploads)
      });

      this.emit('uploadUnregistered', upload);
    }
  }

  performMemoryCleanup() {
    if (this.isCleaningUp) {
      logger.warn('Memory cleanup already in progress, skipping');
      return;
    }

    const now = Date.now();
    if (now - this.lastCleanupTime < 5000) {
      logger.warn('Memory cleanup throttled, too soon since last cleanup');
      return;
    }

    this.isCleaningUp = true;
    this.lastCleanupTime = now;

    try {
      logger.info('Starting memory cleanup');

      if (global.gc) {
        global.gc();
        logger.info('Forced garbage collection');
      }

      this.clearCaches();

      const memUsage = process.memoryUsage();
      logger.info('Memory cleanup completed', {
        heapUsed: this.formatBytes(memUsage.heapUsed),
        heapTotal: this.formatBytes(memUsage.heapTotal)
      });

    } catch (error) {
      logger.error('Error during memory cleanup:', error);
    } finally {
      this.isCleaningUp = false;
    }
  }

  performEmergencyCleanup() {
    if (this.isCleaningUp) {
      logger.warn('Emergency cleanup already in progress, skipping');
      return;
    }

    logger.error('Starting emergency memory cleanup');

    const uploads = Array.from(this.activeUploads.values())
      .sort((a, b) => a.startTime - b.startTime);

    const uploadsToCancel = uploads.slice(0, Math.ceil(uploads.length / 2));
    
    for (const upload of uploadsToCancel) {
      logger.warn('Emergency: Cancelling upload to free memory', {
        uploadId: upload.uploadId,
        fileName: upload.fileName,
        memoryToFree: this.formatBytes(upload.memoryAllocated)
      });
      
      this.emit('uploadCancelled', upload);
      this.unregisterUpload(upload.uploadId);
    }

    this.performMemoryCleanup();

    this.limits.maxConcurrentUploads = Math.max(1, Math.floor(this.limits.maxConcurrentUploads / 2));
    this.limits.maxFileSize = Math.floor(this.limits.maxFileSize / 2);

    logger.warn('Emergency: Temporarily reduced limits', {
      maxConcurrentUploads: this.limits.maxConcurrentUploads,
      maxFileSize: this.formatBytes(this.limits.maxFileSize)
    });

    setTimeout(() => {
      this.resetLimits();
    }, 10 * 60 * 1000);
  }

  clearCaches() {
    logger.info('Internal caches cleared');
  }

  resetLimits() {
    this.limits = {
      maxFileSize: 50 * 1024 * 1024,
      maxConcurrentUploads: 5,
      maxTotalMemoryUsage: 200 * 1024 * 1024,
      streamingThreshold: 10 * 1024 * 1024
    };

    logger.info('Memory limits reset to original values', this.limits);
  }

  getMemoryStats() {
    const currentStatus = this.checkMemoryUsage();
    
    return {
      ...currentStatus,
      limits: this.limits,
      thresholds: this.thresholds,
      peak: {
        heap: this.memoryUsage.peak,
        uploads: Math.max(...Array.from(this.activeUploads.values()).map(u => u.memoryAllocated), 0)
      },
      monitoring: {
        active: this.isMonitoring,
        interval: this.monitoringInterval ? 5000 : null
      }
    };
  }

  updateLimits(newLimits) {
    this.limits = { ...this.limits, ...newLimits };
    logger.info('Memory limits updated', this.limits);
    this.emit('limitsUpdated', this.limits);
  }

  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    logger.info('Memory thresholds updated', this.thresholds);
    this.emit('thresholdsUpdated', this.thresholds);
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  generateReport() {
    const stats = this.getMemoryStats();
    const activeUploads = Array.from(this.activeUploads.values());
    
    return {
      timestamp: new Date().toISOString(),
      summary: {
        systemMemoryUsage: stats.system.percentage.toFixed(2) + '%',
        heapMemoryUsage: stats.heap.percentage.toFixed(2) + '%',
        activeUploads: activeUploads.length,
        totalUploadMemory: this.formatBytes(this.memoryUsage.uploads)
      },
      details: {
        system: stats.system,
        heap: stats.heap,
        limits: this.limits,
        thresholds: this.thresholds,
        activeUploads: activeUploads.map(upload => ({
          uploadId: upload.uploadId,
          fileName: upload.fileName,
          fileSize: this.formatBytes(upload.fileSize),
          duration: Date.now() - upload.startTime
        }))
      },
      recommendations: this.generateRecommendations(stats)
    };
  }

  generateRecommendations(stats) {
    const recommendations = [];

    if (stats.system.percentage > 70) {
      recommendations.push('Consider increasing system memory or reducing concurrent operations');
    }

    if (stats.heap.percentage > 80) {
      recommendations.push('Node.js heap usage is high - consider increasing --max-old-space-size');
    }

    if (this.activeUploads.size > 3) {
      recommendations.push('High number of concurrent uploads - consider implementing upload queuing');
    }

    if (this.memoryUsage.uploads > this.limits.maxTotalMemoryUsage * 0.8) {
      recommendations.push('Upload memory usage approaching limit - consider streaming for large files');
    }

    return recommendations;
  }
}

const memoryMonitor = new MemoryMonitor();

memoryMonitor.startMonitoring();

module.exports = {
  MemoryMonitor,
  memoryMonitor
};