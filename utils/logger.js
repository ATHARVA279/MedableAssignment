const winston = require('winston');
const path = require('path');
const config = require('../config');

const fs = require('fs');
const logsDir = path.dirname(config.logging.file);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

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

const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'file-processing-api' },
  transports: [
    new winston.transports.File({
      filename: config.logging.errorFile,
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    
    new winston.transports.File({
      filename: config.logging.file,
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

if (config.server.isDevelopment) {
  logger.add(new winston.transports.Console({
    format: consoleFormat
  }));
}

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