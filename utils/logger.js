const winston = require('winston');
const path = require('path');
const config = require('../config');

// Ensure logs directory exists
const fs = require('fs');
const logsDir = path.dirname(config.logging.file);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }
    return log;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'file-processing-api' },
  transports: [
    // Error log file
    new winston.transports.File({
      filename: config.logging.errorFile,
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // Combined log file
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Add console transport in development
if (config.server.isDevelopment) {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

// Security event logger
const securityLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'security' },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'security.log'),
      maxsize: 5242880,
      maxFiles: 10
    })
  ]
});

// Audit logger for file operations
const auditLogger = winston.createLogger({
  level: 'info',
  format: logFormat,
  defaultMeta: { service: 'audit' },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      maxsize: 5242880,
      maxFiles: 10
    })
  ]
});

// Helper functions
const logFileOperation = (operation, fileId, userId, details = {}) => {
  auditLogger.info('File operation', {
    operation,
    fileId,
    userId,
    timestamp: new Date().toISOString(),
    ...details
  });
};

const logSecurityEvent = (event, details = {}) => {
  securityLogger.warn('Security event', {
    event,
    timestamp: new Date().toISOString(),
    ...details
  });
};

const logError = (error, context = {}) => {
  logger.error('Application error', {
    message: error.message,
    stack: error.stack,
    ...context
  });
};

module.exports = {
  logger,
  securityLogger,
  auditLogger,
  logFileOperation,
  logSecurityEvent,
  logError
};