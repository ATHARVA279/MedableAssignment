/**
 * Centralized error handling middleware with retry integration
 */

// Custom error class for application errors
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    
    // Retry-related properties
    this.retryAttempts = 0;
    this.totalDuration = 0;
    this.attemptHistory = [];
    this.originalError = null;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

// Enhanced error class for retry-specific errors
class RetryableError extends AppError {
  constructor(message, statusCode = 500, maxRetries = 3) {
    super(message, statusCode, true);
    this.isRetryable = true;
    this.maxRetries = maxRetries;
    this.name = 'RetryableError';
  }
}

// Permanent error class (should not be retried)
class PermanentError extends AppError {
  constructor(message, statusCode = 400) {
    super(message, statusCode, true);
    this.isPermanent = true;
    this.name = 'PermanentError';
  }
}

// Enhanced error logger with retry information
function logError(error, req = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
      statusCode: error.statusCode,
      // Include retry information if available
      retryAttempts: error.retryAttempts || 0,
      totalDuration: error.totalDuration || 0,
      attemptHistory: error.attemptHistory || [],
      isRetryable: error.isRetryable || false,
      isPermanent: error.isPermanent || false,
      originalError: error.originalError ? {
        name: error.originalError.name,
        message: error.originalError.message,
        code: error.originalError.code
      } : null
    },
    request: req ? {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    } : null
  };
  
  console.error('Application Error:', JSON.stringify(logEntry, null, 2));
}

// Sanitize error for client response
function sanitizeError(error) {
  // Don't expose internal errors to clients
  if (!error.isOperational) {
    return {
      error: 'Internal server error',
      message: 'An unexpected error occurred'
    };
  }
  
  return {
    error: error.message
  };
}

// Express error handling middleware
function errorHandler(error, req, res, next) {
  // Log the error
  logError(error, req);
  
  // Determine status code
  let statusCode = 500;
  if (error.statusCode) {
    statusCode = error.statusCode;
  } else if (error.name === 'ValidationError') {
    statusCode = 400;
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
  } else if (error.name === 'JsonWebTokenError') {
    statusCode = 403;
  }
  
  // Send sanitized error response
  const sanitized = sanitizeError(error);
  res.status(statusCode).json(sanitized);
}

// Async error wrapper for route handlers
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Enhanced common error responses with retry information
const commonErrors = {
  notFound: (resource = 'Resource') => new PermanentError(`${resource} not found`, 404),
  unauthorized: (message = 'Authentication required') => new PermanentError(message, 401),
  forbidden: (message = 'Access denied') => new PermanentError(message, 403),
  badRequest: (message = 'Invalid request') => new PermanentError(message, 400),
  payloadTooLarge: (message = 'File too large') => new PermanentError(message, 413),
  unsupportedMediaType: (message = 'Unsupported file type') => new PermanentError(message, 415),
  tooManyRequests: (message = 'Too many requests') => new RetryableError(message, 429, 5),
  
  // New retry-aware errors
  networkError: (message = 'Network error occurred') => new RetryableError(message, 502, 4),
  serviceUnavailable: (message = 'Service temporarily unavailable') => new RetryableError(message, 503, 3),
  timeout: (message = 'Operation timed out') => new RetryableError(message, 408, 3),
  temporaryFailure: (message = 'Temporary failure') => new RetryableError(message, 500, 3),
  
  // Processing specific errors
  processingFailed: (message = 'File processing failed') => new RetryableError(message, 422, 2),
  uploadFailed: (message = 'File upload failed') => new RetryableError(message, 500, 5),
  storageFailed: (message = 'Storage operation failed') => new RetryableError(message, 500, 3)
};

// Async handler with retry integration awareness
function asyncHandlerWithRetry(fn, retryConfig = {}) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(error => {
      // Tag error with retry configuration if not already present
      if (!error.retryConfig && retryConfig) {
        error.retryConfig = retryConfig;
      }
      next(error);
    });
  };
}

module.exports = {
  AppError,
  RetryableError,
  PermanentError,
  errorHandler,
  asyncHandler,
  asyncHandlerWithRetry,
  logError,
  sanitizeError,
  commonErrors
};