const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger');
const { retryOperations, RetryManager } = require('./retryManager');
const { AppError, RetryableError, PermanentError } = require('../middleware/errorHandler');

const JOB_PRIORITIES = {
  LOW: 1,
  NORMAL: 2,
  HIGH: 3,
  URGENT: 4,
  CRITICAL: 5
};

const JOB_STATUSES = {
  PENDING: 'pending',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying'
};

const JOB_TYPES = {
  FILE_UPLOAD: 'file_upload',
  FILE_PROCESSING: 'file_processing',
  FILE_COMPRESSION: 'file_compression',
  THUMBNAIL_GENERATION: 'thumbnail_generation',
  VIRUS_SCAN: 'virus_scan',
  BATCH_PROCESSING: 'batch_processing',
  FILE_CLEANUP: 'file_cleanup'
};

class Job {
  constructor(data) {
    this.id = data.id || uuidv4();
    this.type = data.type;
    this.priority = data.priority || JOB_PRIORITIES.NORMAL;
    this.status = JOB_STATUSES.PENDING;
    this.data = data.data || {};
    this.userId = data.userId;
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.attempts = 0;
    this.maxAttempts = data.maxAttempts || 3;
    this.delay = data.delay || 0;
    this.nextAttemptAt = new Date(Date.now() + this.delay);
    this.errors = [];
    this.result = null;
    this.progress = 0;
    this.metadata = data.metadata || {};
    
    this.retryManager = new RetryManager({
      maxRetries: this.maxAttempts - 1,
      initialDelay: 1000,
      maxDelay: 60000,
      backoffMultiplier: 2
    });
  }

  updateStatus(status, data = {}) {
    this.status = status;
    this.updatedAt = new Date();
    
    if (data.progress !== undefined) {
      this.progress = Math.max(0, Math.min(100, data.progress));
    }
    
    if (data.error) {
      this.errors.push({
        message: data.error.message,
        code: data.error.code,
        timestamp: new Date(),
        attempt: this.attempts
      });
    }
    
    if (data.result) {
      this.result = data.result;
    }

    logger.debug('Job status updated', {
      jobId: this.id,
      type: this.type,
      status,
      progress: this.progress,
      attempts: this.attempts
    });
  }

  canRetry() {
    return this.attempts < this.maxAttempts && 
           this.status === JOB_STATUSES.FAILED &&
           this.nextAttemptAt <= new Date();
  }

  prepareRetry() {
    if (!this.canRetry()) {
      throw new Error('Job cannot be retried');
    }

    this.attempts++;
    this.status = JOB_STATUSES.RETRYING;
    this.updatedAt = new Date();
    
    const delay = Math.min(1000 * Math.pow(2, this.attempts - 1), 60000);
    this.nextAttemptAt = new Date(Date.now() + delay);

    logger.info('Job prepared for retry', {
      jobId: this.id,
      type: this.type,
      attempt: this.attempts,
      maxAttempts: this.maxAttempts,
      nextAttemptAt: this.nextAttemptAt
    });
  }

  getSummary() {
    return {
      id: this.id,
      type: this.type,
      priority: this.priority,
      status: this.status,
      progress: this.progress,
      attempts: this.attempts,
      maxAttempts: this.maxAttempts,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      userId: this.userId,
      hasErrors: this.errors.length > 0,
      errorCount: this.errors.length
    };
  }
}

class JobQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.name = options.name || 'default';
    this.concurrency = options.concurrency || 5;
    this.maxJobs = options.maxJobs || 1000;
    this.cleanupInterval = options.cleanupInterval || 60000; 
    this.retryInterval = options.retryInterval || 30000; 
    
    this.jobs = new Map();
    this.processing = new Map();
    this.completed = [];
    this.failed = [];
    
    this.isProcessing = false;
    this.processingCount = 0;
    
    this.stats = {
      totalJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      retriedJobs: 0,
      averageProcessingTime: 0,
      lastProcessedAt: null
    };

    this.processors = new Map();
    
    this.startCleanupTimer();
    this.startRetryTimer();

    logger.info('Job queue initialized', {
      name: this.name,
      concurrency: this.concurrency,
      maxJobs: this.maxJobs
    });
  }

  registerProcessor(jobType, processor) {
    if (typeof processor !== 'function') {
      throw new Error('Processor must be a function');
    }

    this.processors.set(jobType, processor);
    logger.debug('Job processor registered', { jobType, queueName: this.name });
  }

  async addJob(jobType, data, options = {}) {
    try {
      if (this.jobs.size >= this.maxJobs) {
        throw new Error(`Queue is full (${this.maxJobs} jobs)`);
      }

      if (!this.processors.has(jobType)) {
        throw new Error(`No processor registered for job type: ${jobType}`);
      }

      const job = new Job({
        type: jobType,
        data,
        userId: options.userId,
        priority: options.priority || JOB_PRIORITIES.NORMAL,
        maxAttempts: options.maxAttempts || 3,
        delay: options.delay || 0,
        metadata: options.metadata || {}
      });

      this.jobs.set(job.id, job);
      job.updateStatus(JOB_STATUSES.QUEUED);
      
      this.stats.totalJobs++;
      
      logger.info('Job added to queue', {
        jobId: job.id,
        type: jobType,
        priority: job.priority,
        queueSize: this.jobs.size,
        queueName: this.name
      });

      this.emit('job:added', job);
      
      if (!this.isProcessing) {
        setImmediate(() => this.processQueue());
      }

      return job.id;

    } catch (error) {
      logger.error('Failed to add job to queue', {
        jobType,
        error: error.message,
        queueName: this.name
      });
      throw error;
    }
  }

  async processQueue() {
    if (this.isProcessing || this.processingCount >= this.concurrency) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.processingCount < this.concurrency) {
        const job = this.getNextJob();
        if (!job) break;

        this.processJob(job);
      }
    } catch (error) {
      logger.error('Error in queue processing', {
        error: error.message,
        queueName: this.name
      });
    } finally {
      this.isProcessing = false;
    }
  }

  getNextJob() {
    const availableJobs = Array.from(this.jobs.values())
      .filter(job => 
        job.status === JOB_STATUSES.QUEUED && 
        job.nextAttemptAt <= new Date()
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority;
        }
        return a.createdAt - b.createdAt;
      });

    return availableJobs[0] || null;
  }

  async processJob(job) {
    this.processingCount++;
    this.processing.set(job.id, job);
    
    const startTime = Date.now();
    job.attempts++;
    job.startedAt = new Date();
    job.updateStatus(JOB_STATUSES.PROCESSING);

    logger.info('Processing job', {
      jobId: job.id,
      type: job.type,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      processingCount: this.processingCount
    });

    this.emit('job:started', job);

    try {
      const processor = this.processors.get(job.type);
      if (!processor) {
        throw new PermanentError(`No processor found for job type: ${job.type}`);
      }

      const result = await Promise.race([
        processor(job.data, job),
        this.createJobTimeout(job)
      ]);

      const processingTime = Date.now() - startTime;
      job.completedAt = new Date();
      job.updateStatus(JOB_STATUSES.COMPLETED, { result });

      this.moveJobToCompleted(job);
      this.updateStats(true, processingTime);

      logger.info('Job completed successfully', {
        jobId: job.id,
        type: job.type,
        processingTime,
        attempts: job.attempts
      });

      this.emit('job:completed', job, result);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const isRetryable = !(error instanceof PermanentError);
      
      job.updateStatus(JOB_STATUSES.FAILED, { error });

      logger.error('Job processing failed', {
        jobId: job.id,
        type: job.type,
        error: error.message,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        isRetryable,
        processingTime
      });

      if (job.canRetry() && isRetryable) {
        job.prepareRetry();
        this.stats.retriedJobs++;
        
        logger.info('Job scheduled for retry', {
          jobId: job.id,
          nextAttempt: job.attempts,
          nextAttemptAt: job.nextAttemptAt
        });

        this.emit('job:retry', job, error);
      } else {
        this.moveJobToFailed(job);
        this.updateStats(false, processingTime);
        
        logger.error('Job permanently failed', {
          jobId: job.id,
          type: job.type,
          totalAttempts: job.attempts,
          error: error.message
        });

        this.emit('job:failed', job, error);
      }
    } finally {
      this.processing.delete(job.id);
      this.processingCount--;
      
      setImmediate(() => this.processQueue());
    }
  }

  createJobTimeout(job) {
    const timeout = job.metadata.timeout || 300000; // 5 minutes default
    
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new RetryableError(`Job timeout after ${timeout}ms`));
      }, timeout);
    });
  }

  moveJobToCompleted(job) {
    this.jobs.delete(job.id);
    this.completed.push(job);
    
    if (this.completed.length > 100) {
      this.completed.shift();
    }
  }

  moveJobToFailed(job) {
    this.jobs.delete(job.id);
    this.failed.push(job);
    
    if (this.failed.length > 50) {
      this.failed.shift();
    }
  }

  updateStats(success, processingTime) {
    if (success) {
      this.stats.completedJobs++;
    } else {
      this.stats.failedJobs++;
    }

    const totalProcessed = this.stats.completedJobs + this.stats.failedJobs;
    this.stats.averageProcessingTime = 
      (this.stats.averageProcessingTime * (totalProcessed - 1) + processingTime) / totalProcessed;
    
    this.stats.lastProcessedAt = new Date();
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || 
           this.completed.find(j => j.id === jobId) ||
           this.failed.find(j => j.id === jobId);
  }

  async cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error('Job not found');
    }

    if (job.status === JOB_STATUSES.PROCESSING) {
      throw new Error('Cannot cancel job that is currently processing');
    }

    job.updateStatus(JOB_STATUSES.CANCELLED);
    this.jobs.delete(jobId);

    logger.info('Job cancelled', { jobId, type: job.type });
    this.emit('job:cancelled', job);

    return job;
  }

  getStats() {
    return {
      ...this.stats,
      queueSize: this.jobs.size,
      processingCount: this.processingCount,
      completedCount: this.completed.length,
      failedCount: this.failed.length,
      registeredProcessors: Array.from(this.processors.keys())
    };
  }

  getJobs(filters = {}) {
    let jobs = Array.from(this.jobs.values());
    
    if (filters.status) {
      jobs = jobs.filter(job => job.status === filters.status);
    }
    
    if (filters.userId) {
      jobs = jobs.filter(job => job.userId === filters.userId);
    }
    
    if (filters.type) {
      jobs = jobs.filter(job => job.type === filters.type);
    }

    return jobs.map(job => job.getSummary());
  }

  startCleanupTimer() {
    setInterval(() => {
      this.cleanupOldJobs();
    }, this.cleanupInterval);
  }

  startRetryTimer() {
    setInterval(() => {
      this.retryFailedJobs();
    }, this.retryInterval);
  }

  cleanupOldJobs() {
    const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours

    this.completed = this.completed.filter(job => 
      job.completedAt && job.completedAt.getTime() > cutoffTime
    );

    this.failed = this.failed.filter(job => 
      job.updatedAt.getTime() > cutoffTime
    );

    logger.debug('Cleaned up old jobs', {
      queueName: this.name,
      completedJobs: this.completed.length,
      failedJobs: this.failed.length
    });
  }

  retryFailedJobs() {
    const retryableJobs = Array.from(this.jobs.values())
      .filter(job => job.status === JOB_STATUSES.FAILED && job.canRetry());

    for (const job of retryableJobs) {
      job.updateStatus(JOB_STATUSES.QUEUED);
      logger.debug('Job queued for retry', {
        jobId: job.id,
        attempt: job.attempts + 1
      });
    }

    if (retryableJobs.length > 0 && !this.isProcessing) {
      setImmediate(() => this.processQueue());
    }
  }

  async shutdown() {
    logger.info('Shutting down job queue', { queueName: this.name });
    
    while (this.processingCount > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.removeAllListeners();
    logger.info('Job queue shutdown complete', { queueName: this.name });
  }
}

class QueueManager {
  constructor() {
    this.queues = new Map();
    this.defaultQueue = null;
  }

  getQueue(name = 'default', options = {}) {
    if (!this.queues.has(name)) {
      const queue = new JobQueue({ name, ...options });
      this.queues.set(name, queue);
      
      if (!this.defaultQueue) {
        this.defaultQueue = queue;
      }
    }
    
    return this.queues.get(name);
  }

  getAllStats() {
    const stats = {};
    for (const [name, queue] of this.queues) {
      stats[name] = queue.getStats();
    }
    return stats;
  }

  async shutdown() {
    const shutdownPromises = Array.from(this.queues.values())
      .map(queue => queue.shutdown());
    
    await Promise.all(shutdownPromises);
    this.queues.clear();
    this.defaultQueue = null;
  }
}

const queueManager = new QueueManager();

module.exports = {
  Job,
  JobQueue,
  QueueManager,
  queueManager,
  JOB_PRIORITIES,
  JOB_STATUSES,
  JOB_TYPES
};