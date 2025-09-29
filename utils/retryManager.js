const { logger } = require('./logger');
const { AppError } = require('../middleware/errorHandler');

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'NETWORK_ERROR',
    'TIMEOUT_ERROR',
    'SERVICE_UNAVAILABLE',
    'RATE_LIMITED',
    'TEMPORARY_FAILURE'
  ]
};

class ErrorClassifier {
  static isRetryable(error, retryableErrors = DEFAULT_RETRY_CONFIG.retryableErrors) {
    if (!error) return false;

    if (error.code && retryableErrors.includes(error.code)) {
      return true;
    }

    const message = error.message?.toLowerCase() || '';
    const retryablePatterns = [
      'timeout',
      'network',
      'connection',
      'unavailable',
      'rate limit',
      'temporary',
      'transient',
      'cloudinary',
      'socket hang up',
      'econnreset',
      'econnrefused',
      'etimedout'
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  static isPermanent(error) {
    if (!error) return false;

    const permanentCodes = [
      'ENOENT',
      'EACCES',
      'EPERM',
      'INVALID_FILE',
      'MALFORMED_DATA',
      'AUTHENTICATION_ERROR',
      'AUTHORIZATION_ERROR'
    ];

    if (error.code && permanentCodes.includes(error.code)) {
      return true;
    }

    if (error.statusCode || error.status) {
      const status = error.statusCode || error.status;
      return status >= 400 && status < 500 && status !== 408 && status !== 429;
    }

    const message = error.message?.toLowerCase() || '';
    const permanentPatterns = [
      'invalid',
      'unauthorized',
      'forbidden',
      'not found',
      'malformed',
      'corrupt',
      'unsupported',
      'exceeded quota'
    ];

    return permanentPatterns.some(pattern => message.includes(pattern));
  }

  static getErrorCategory(error) {
    if (this.isPermanent(error)) return 'permanent';
    if (this.isRetryable(error)) return 'retryable';
    return 'unknown';
  }
}

class RetryManager {
  constructor(config = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
    this.attemptHistory = [];
  }

  calculateDelay(attempt) {
    const baseDelay = this.config.initialDelay * Math.pow(this.config.backoffMultiplier, attempt);
    const cappedDelay = Math.min(baseDelay, this.config.maxDelay);
    
    if (this.config.jitter) {
      const jitterRange = cappedDelay * 0.1;
      const jitter = (Math.random() - 0.5) * 2 * jitterRange;
      return Math.max(100, cappedDelay + jitter);
    }
    
    return cappedDelay;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async execute(operation, context = {}) {
    const { operationName = 'Unknown', ...operationContext } = context;
    const startTime = Date.now();
    let lastError = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const attemptStartTime = Date.now();
      
      try {
        logger.debug(`Retry attempt ${attempt + 1}/${this.config.maxRetries + 1} for ${operationName}`, {
          attempt,
          operationName,
          context: operationContext
        });

        const result = await operation();
        
        const totalDuration = Date.now() - startTime;
        const attemptDuration = Date.now() - attemptStartTime;
        
        if (attempt > 0) {
          logger.info(`Operation succeeded after ${attempt + 1} attempts`, {
            operationName,
            totalAttempts: attempt + 1,
            totalDuration,
            lastAttemptDuration: attemptDuration,
            context: operationContext
          });
        }

        this.attemptHistory.push({
          attempt,
          success: true,
          duration: attemptDuration,
          timestamp: new Date().toISOString()
        });

        return result;

      } catch (error) {
        lastError = error;
        const attemptDuration = Date.now() - attemptStartTime;
        const errorCategory = ErrorClassifier.getErrorCategory(error);

        this.attemptHistory.push({
          attempt,
          success: false,
          error: {
            message: error.message,
            code: error.code,
            statusCode: error.statusCode || error.status,
            category: errorCategory
          },
          duration: attemptDuration,
          timestamp: new Date().toISOString()
        });

        logger.warn(`Retry attempt ${attempt + 1} failed for ${operationName}`, {
          attempt,
          operationName,
          error: error.message,
          errorCode: error.code,
          errorCategory,
          duration: attemptDuration,
          context: operationContext
        });

        if (ErrorClassifier.isPermanent(error)) {
          logger.error(`Permanent error detected, aborting retries for ${operationName}`, {
            operationName,
            error: error.message,
            errorCode: error.code,
            totalAttempts: attempt + 1,
            context: operationContext
          });
          throw error;
        }

        if (!ErrorClassifier.isRetryable(error) && errorCategory !== 'unknown') {
          logger.error(`Non-retryable error detected, aborting retries for ${operationName}`, {
            operationName,
            error: error.message,
            errorCode: error.code,
            totalAttempts: attempt + 1,
            context: operationContext
          });
          throw error;
        }

        if (attempt >= this.config.maxRetries) {
          const totalDuration = Date.now() - startTime;
          logger.error(`All retry attempts exhausted for ${operationName}`, {
            operationName,
            totalAttempts: attempt + 1,
            totalDuration,
            finalError: error.message,
            attemptHistory: this.attemptHistory,
            context: operationContext
          });
          
          const enhancedError = new AppError(
            `Operation failed after ${attempt + 1} attempts: ${error.message}`,
            error.statusCode || 500,
            true
          );
          enhancedError.originalError = error;
          enhancedError.retryAttempts = attempt + 1;
          enhancedError.totalDuration = totalDuration;
          enhancedError.attemptHistory = this.attemptHistory;
          
          throw enhancedError;
        }

        const delay = this.calculateDelay(attempt);
        logger.debug(`Waiting ${delay}ms before next retry attempt`, {
          operationName,
          attempt,
          delay,
          context: operationContext
        });

        await this.sleep(delay);
      }
    }
    throw lastError;
  }

  getStats() {
    return {
      totalAttempts: this.attemptHistory.length,
      successfulAttempts: this.attemptHistory.filter(a => a.success).length,
      failedAttempts: this.attemptHistory.filter(a => !a.success).length,
      averageDuration: this.attemptHistory.length > 0 
        ? this.attemptHistory.reduce((sum, a) => sum + a.duration, 0) / this.attemptHistory.length 
        : 0,
      attemptHistory: this.attemptHistory
    };
  }
}

const retryManagers = {
  fileUpload: new RetryManager({
    maxRetries: 5,
    initialDelay: 2000,
    maxDelay: 60000,
    backoffMultiplier: 2
  }),

  fileProcessing: new RetryManager({
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2
  }),

  network: new RetryManager({
    maxRetries: 4,
    initialDelay: 500,
    maxDelay: 10000,
    backoffMultiplier: 1.5
  }),

  database: new RetryManager({
    maxRetries: 2,
    initialDelay: 1000,
    maxDelay: 5000,
    backoffMultiplier: 2
  }),

  externalApi: new RetryManager({
    maxRetries: 3,
    initialDelay: 1500,
    maxDelay: 20000,
    backoffMultiplier: 2
  })
};

const retryOperations = {
  async fileUpload(operation, context = {}) {
    return retryManagers.fileUpload.execute(operation, {
      operationName: 'File Upload',
      ...context
    });
  },

  async fileProcessing(operation, context = {}) {
    return retryManagers.fileProcessing.execute(operation, {
      operationName: 'File Processing',
      ...context
    });
  },

  async network(operation, context = {}) {
    return retryManagers.network.execute(operation, {
      operationName: 'Network Operation',
      ...context
    });
  },

  async database(operation, context = {}) {
    return retryManagers.database.execute(operation, {
      operationName: 'Database Operation',
      ...context
    });
  },

  async externalApi(operation, context = {}) {
    return retryManagers.externalApi.execute(operation, {
      operationName: 'External API Call',
      ...context
    });
  }
};

module.exports = {
  RetryManager,
  ErrorClassifier,
  retryOperations,
  retryManagers,
  DEFAULT_RETRY_CONFIG
};