const { logger } = require('./logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Access Logger for file operations audit trail
 */
class AccessLogger {
  constructor() {
    this.accessLogs = new Map();
    this.logFile = path.join(__dirname, '../logs/access.log');
    this.ensureLogDirectory();
  }

  async ensureLogDirectory() {
    try {
      const logDir = path.dirname(this.logFile);
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  /**
   * Log file access event
   */
  async logFileAccess(fileId, userId, action, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      fileId,
      userId,
      action, // 'upload', 'download', 'view', 'delete', 'share', 'preview'
      ip: metadata.ip,
      userAgent: metadata.userAgent,
      success: metadata.success !== false,
      error: metadata.error,
      fileSize: metadata.fileSize,
      fileName: metadata.fileName,
      shareToken: metadata.shareToken,
      sessionId: metadata.sessionId
    };

    // Store in memory for quick access
    if (!this.accessLogs.has(fileId)) {
      this.accessLogs.set(fileId, []);
    }
    this.accessLogs.get(fileId).push(logEntry);

    // Keep only last 100 entries per file in memory
    const logs = this.accessLogs.get(fileId);
    if (logs.length > 100) {
      logs.splice(0, logs.length - 100);
    }

    // Log to file asynchronously
    this.writeToFile(logEntry);

    // Log to main logger
    logger.info('File access logged', logEntry);
  }

  /**
   * Write log entry to file
   */
  async writeToFile(logEntry) {
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      await fs.appendFile(this.logFile, logLine);
    } catch (error) {
      logger.error('Failed to write access log to file', { error: error.message });
    }
  }

  /**
   * Get access logs for a file
   */
  getFileAccessLogs(fileId, limit = 50) {
    const logs = this.accessLogs.get(fileId) || [];
    return logs.slice(-limit).reverse(); // Most recent first
  }

  /**
   * Get user activity logs
   */
  getUserActivityLogs(userId, limit = 100) {
    const userLogs = [];
    
    for (const [fileId, logs] of this.accessLogs.entries()) {
      const userFileLogs = logs.filter(log => log.userId === userId);
      userLogs.push(...userFileLogs);
    }

    return userLogs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Get system-wide access statistics
   */
  getAccessStatistics(timeRange = '24h') {
    const now = new Date();
    const cutoff = new Date(now.getTime() - this.parseTimeRange(timeRange));
    
    let totalAccess = 0;
    let uniqueUsers = new Set();
    let uniqueFiles = new Set();
    let actionCounts = {};

    for (const [fileId, logs] of this.accessLogs.entries()) {
      const recentLogs = logs.filter(log => new Date(log.timestamp) > cutoff);
      
      recentLogs.forEach(log => {
        totalAccess++;
        uniqueUsers.add(log.userId);
        uniqueFiles.add(fileId);
        actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
      });
    }

    return {
      timeRange,
      totalAccess,
      uniqueUsers: uniqueUsers.size,
      uniqueFiles: uniqueFiles.size,
      actionBreakdown: actionCounts,
      generatedAt: now.toISOString()
    };
  }

  /**
   * Parse time range string to milliseconds
   */
  parseTimeRange(timeRange) {
    const units = {
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000,
      'w': 7 * 24 * 60 * 60 * 1000
    };

    const match = timeRange.match(/^(\d+)([hdw])$/);
    if (!match) return 24 * 60 * 60 * 1000; // Default 24h

    const [, amount, unit] = match;
    return parseInt(amount) * units[unit];
  }

  /**
   * Clean up old logs (keep last 30 days)
   */
  async cleanupOldLogs() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    for (const [fileId, logs] of this.accessLogs.entries()) {
      const recentLogs = logs.filter(log => new Date(log.timestamp) > thirtyDaysAgo);
      this.accessLogs.set(fileId, recentLogs);
    }

    logger.info('Access logs cleanup completed', {
      cutoffDate: thirtyDaysAgo.toISOString(),
      remainingFiles: this.accessLogs.size
    });
  }

  /**
   * Export access logs for compliance/audit
   */
  async exportLogs(startDate, endDate, format = 'json') {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const exportLogs = [];

    for (const [fileId, logs] of this.accessLogs.entries()) {
      const filteredLogs = logs.filter(log => {
        const logDate = new Date(log.timestamp);
        return logDate >= start && logDate <= end;
      });
      exportLogs.push(...filteredLogs);
    }

    exportLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (format === 'csv') {
      return this.convertToCSV(exportLogs);
    }

    return {
      exportRange: { startDate, endDate },
      totalEntries: exportLogs.length,
      logs: exportLogs
    };
  }

  /**
   * Convert logs to CSV format
   */
  convertToCSV(logs) {
    if (logs.length === 0) return 'No logs found for the specified range';

    const headers = ['timestamp', 'fileId', 'userId', 'action', 'ip', 'success', 'fileName', 'fileSize'];
    const csvRows = [headers.join(',')];

    logs.forEach(log => {
      const row = headers.map(header => {
        const value = log[header] || '';
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
      });
      csvRows.push(row.join(','));
    });

    return csvRows.join('\n');
  }
}

// Global access logger instance
const accessLogger = new AccessLogger();

// Cleanup old logs every 24 hours
setInterval(() => {
  accessLogger.cleanupOldLogs();
}, 24 * 60 * 60 * 1000);

module.exports = {
  AccessLogger,
  accessLogger
};