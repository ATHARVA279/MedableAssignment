const { v4: uuidv4 } = require('uuid');
const { logger } = require('./logger');
const { saveFile } = require('./fileStorage');
const { validateFile } = require('../middleware/fileValidation');
const { processFile, enhancedProcessingTracker } = require('./enhancedFileProcessor');
const { retryOperations } = require('./retryManager');
const { queueManager, JOB_TYPES, JOB_PRIORITIES } = require('./jobQueue');

const batchJobs = new Map();

async function createBatchJob(files, userId, options = {}) {
  try {
    const batchId = uuidv4();
    const {
      processInParallel = true,
      maxConcurrency = 3,
      description = '',
      notifyOnComplete = false
    } = options;
    
    const batchJob = {
      batchId,
      userId,
      description,
      status: 'created',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      totalFiles: files.length,
      processedFiles: 0,
      failedFiles: 0,
      successfulFiles: 0,
      processInParallel,
      maxConcurrency,
      notifyOnComplete,
      files: files.map((file, index) => ({
        fileIndex: index,
        originalName: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
        status: 'pending',
        fileId: null,
        publicId: null,
        secureUrl: null,
        error: null,
        processedAt: null
      })),
      progress: 0,
      errors: [],
      results: []
    };
    
    batchJobs.set(batchId, batchJob);
    
    logger.info('Batch job created', {
      batchId,
      userId,
      totalFiles: files.length,
      processInParallel
    });
    
    return batchJob;
  } catch (error) {
    logger.error('Failed to create batch job', {
      error: error.message,
      userId,
      filesCount: files.length
    });
    throw error;
  }
}

async function startBatchProcessing(batchId) {
  try {
    const batchJob = batchJobs.get(batchId);
    if (!batchJob) {
      throw new Error('Batch job not found');
    }
    
    if (batchJob.status !== 'created') {
      throw new Error('Batch job already started or completed');
    }
    
    batchJob.status = 'processing';
    batchJob.startedAt = new Date().toISOString();
    
    logger.info('Batch processing started', {
      batchId,
      totalFiles: batchJob.totalFiles,
      processInParallel: batchJob.processInParallel
    });
    
    if (batchJob.processInParallel) {
      await processBatchInParallel(batchJob);
    } else {
      await processBatchSequentially(batchJob);
    }
    
    batchJob.status = batchJob.failedFiles > 0 ? 'completed_with_errors' : 'completed';
    batchJob.completedAt = new Date().toISOString();
    batchJob.progress = 100;
    
    logger.info('Batch processing completed', {
      batchId,
      status: batchJob.status,
      successfulFiles: batchJob.successfulFiles,
      failedFiles: batchJob.failedFiles
    });
    
    return batchJob;
  } catch (error) {
    const batchJob = batchJobs.get(batchId);
    if (batchJob) {
      batchJob.status = 'failed';
      batchJob.completedAt = new Date().toISOString();
      batchJob.errors.push({
        type: 'batch_error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.error('Batch processing failed', {
      error: error.message,
      batchId
    });
    throw error;
  }
}

async function processBatchInParallel(batchJob) {
  const { files, maxConcurrency } = batchJob;
  const semaphore = new Semaphore(maxConcurrency);
  
  const promises = files.map(async (file) => {
    await semaphore.acquire();
    try {
      await processSingleFileInBatch(batchJob, file);
    } finally {
      semaphore.release();
    }
  });
  
  await Promise.all(promises);
}

async function processBatchSequentially(batchJob) {
  const { files } = batchJob;
  
  for (const file of files) {
    await processSingleFileInBatch(batchJob, file);
  }
}

async function processSingleFileInBatch(batchJob, file) {
  try {
    file.status = 'processing';
    updateBatchProgress(batchJob);
    
    await validateFile({
      originalname: file.originalName,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer
    });
    
    const storageResult = await saveFile(file.buffer, file.originalName, file.mimetype);
    
    file.fileId = uuidv4();
    file.publicId = storageResult.publicId;
    file.secureUrl = storageResult.secureUrl;
    
    const processingResult = await processFile({
      id: file.fileId,
      originalName: file.originalName,
      mimetype: file.mimetype,
      size: file.size
    }, storageResult);
    
    file.status = 'completed';
    file.processedAt = new Date().toISOString();
    file.processingResult = processingResult.result;
    
    batchJob.successfulFiles++;
    batchJob.results.push({
      fileIndex: file.fileIndex,
      fileId: file.fileId,
      originalName: file.originalName,
      secureUrl: file.secureUrl,
      status: 'success',
      processingResult: processingResult.result
    });
    
    logger.info('Batch file processed successfully', {
      batchId: batchJob.batchId,
      fileIndex: file.fileIndex,
      originalName: file.originalName
    });
    
  } catch (error) {
    file.status = 'failed';
    file.error = error.message;
    file.processedAt = new Date().toISOString();
    
    batchJob.failedFiles++;
    batchJob.errors.push({
      fileIndex: file.fileIndex,
      originalName: file.originalName,
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    logger.error('Batch file processing failed', {
      batchId: batchJob.batchId,
      fileIndex: file.fileIndex,
      originalName: file.originalName,
      error: error.message
    });
  } finally {
    batchJob.processedFiles++;
    updateBatchProgress(batchJob);
  }
}

function updateBatchProgress(batchJob) {
  batchJob.progress = Math.round((batchJob.processedFiles / batchJob.totalFiles) * 100);
}

function getBatchJob(batchId, userId, userRole) {
  const batchJob = batchJobs.get(batchId);
  
  if (!batchJob) {
    return null;
  }
  
  if (batchJob.userId !== userId && userRole !== 'admin') {
    return null;
  }
  
  return {
    batchId: batchJob.batchId,
    userId: batchJob.userId,
    description: batchJob.description,
    status: batchJob.status,
    createdAt: batchJob.createdAt,
    startedAt: batchJob.startedAt,
    completedAt: batchJob.completedAt,
    totalFiles: batchJob.totalFiles,
    processedFiles: batchJob.processedFiles,
    successfulFiles: batchJob.successfulFiles,
    failedFiles: batchJob.failedFiles,
    progress: batchJob.progress,
    processInParallel: batchJob.processInParallel,
    maxConcurrency: batchJob.maxConcurrency,
    results: batchJob.results,
    errors: batchJob.errors.map(error => ({
      fileIndex: error.fileIndex,
      originalName: error.originalName,
      error: error.error,
      timestamp: error.timestamp
    }))
  };
}

function getUserBatchJobs(userId, userRole) {
  const userJobs = [];
  
  for (const [batchId, batchJob] of batchJobs.entries()) {
    if (batchJob.userId === userId || userRole === 'admin') {
      userJobs.push({
        batchId: batchJob.batchId,
        description: batchJob.description,
        status: batchJob.status,
        createdAt: batchJob.createdAt,
        totalFiles: batchJob.totalFiles,
        successfulFiles: batchJob.successfulFiles,
        failedFiles: batchJob.failedFiles,
        progress: batchJob.progress
      });
    }
  }
  
  return userJobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function cancelBatchJob(batchId, userId, userRole) {
  const batchJob = batchJobs.get(batchId);
  
  if (!batchJob) {
    throw new Error('Batch job not found');
  }
  
  if (batchJob.userId !== userId && userRole !== 'admin') {
    throw new Error('Access denied');
  }
  
  if (batchJob.status === 'completed' || batchJob.status === 'completed_with_errors') {
    throw new Error('Cannot cancel completed batch job');
  }
  
  batchJob.status = 'cancelled';
  batchJob.completedAt = new Date().toISOString();
  
  logger.info('Batch job cancelled', {
    batchId,
    userId,
    processedFiles: batchJob.processedFiles,
    totalFiles: batchJob.totalFiles
  });
  
  return batchJob;
}

function deleteBatchJob(batchId, userId, userRole) {
  const batchJob = batchJobs.get(batchId);
  
  if (!batchJob) {
    throw new Error('Batch job not found');
  }
  
  if (batchJob.userId !== userId && userRole !== 'admin') {
    throw new Error('Access denied');
  }
  
  batchJobs.delete(batchId);
  
  logger.info('Batch job deleted', {
    batchId,
    userId
  });
  
  return true;
}

class Semaphore {
  constructor(maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
    this.currentConcurrency = 0;
    this.queue = [];
  }
  
  async acquire() {
    return new Promise((resolve) => {
      if (this.currentConcurrency < this.maxConcurrency) {
        this.currentConcurrency++;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }
  
  release() {
    this.currentConcurrency--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      this.currentConcurrency++;
      next();
    }
  }
}

function getBatchStats(userId, userRole) {
  let totalJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let totalFiles = 0;
  let successfulFiles = 0;
  let failedFiles = 0;
  
  for (const [batchId, batchJob] of batchJobs.entries()) {
    if (batchJob.userId === userId || userRole === 'admin') {
      totalJobs++;
      totalFiles += batchJob.totalFiles;
      successfulFiles += batchJob.successfulFiles;
      failedFiles += batchJob.failedFiles;
      
      if (batchJob.status === 'completed') {
        completedJobs++;
      } else if (batchJob.status === 'failed') {
        failedJobs++;
      }
    }
  }
  
  return {
    totalJobs,
    completedJobs,
    failedJobs,
    totalFiles,
    successfulFiles,
    failedFiles,
    successRate: totalFiles > 0 ? Math.round((successfulFiles / totalFiles) * 100) : 0
  };
}

module.exports = {
  createBatchJob,
  startBatchProcessing,
  getBatchJob,
  getUserBatchJobs,
  cancelBatchJob,
  deleteBatchJob,
  getBatchStats
};