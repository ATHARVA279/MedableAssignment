const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler, commonErrors } = require('../middleware/errorHandler');
const {
  createBatchJob,
  startBatchProcessing,
  getBatchJob,
  getUserBatchJobs,
  cancelBatchJob,
  deleteBatchJob,
  getBatchStats
} = require('../utils/batchProcessor');

const router = express.Router();

// Configure multer for batch uploads (multiple files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 10 // Maximum 10 files per batch
  }
});

/**
 * Create and start batch upload job
 * POST /api/batch/upload
 */
router.post('/upload', authenticateToken, upload.array('files', 10), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw commonErrors.badRequest('No files provided');
  }
  
  const {
    description = '',
    processInParallel = 'true',
    maxConcurrency = '3',
    notifyOnComplete = 'false'
  } = req.body;
  
  const options = {
    description,
    processInParallel: processInParallel === 'true',
    maxConcurrency: parseInt(maxConcurrency) || 3,
    notifyOnComplete: notifyOnComplete === 'true'
  };
  
  // Create batch job
  const batchJob = await createBatchJob(req.files, req.user.userId, options);
  
  // Start processing immediately
  setImmediate(async () => {
    try {
      await startBatchProcessing(batchJob.batchId);
    } catch (error) {
      console.error('Batch processing failed:', error);
    }
  });
  
  res.status(201).json({
    message: 'Batch upload job created and started',
    batchJob: {
      batchId: batchJob.batchId,
      description: batchJob.description,
      status: batchJob.status,
      totalFiles: batchJob.totalFiles,
      processInParallel: batchJob.processInParallel,
      maxConcurrency: batchJob.maxConcurrency,
      createdAt: batchJob.createdAt
    }
  });
}));

/**
 * Get batch job status
 * GET /api/batch/:batchId
 */
router.get('/:batchId', authenticateToken, asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  
  const batchJob = getBatchJob(batchId, req.user.userId, req.user.role);
  
  if (!batchJob) {
    throw commonErrors.notFound('Batch job');
  }
  
  res.json({
    batchJob
  });
}));

/**
 * Get user's batch jobs
 * GET /api/batch
 */
router.get('/', authenticateToken, asyncHandler(async (req, res) => {
  const { status, limit = '20', offset = '0' } = req.query;
  
  let batchJobs = getUserBatchJobs(req.user.userId, req.user.role);
  
  // Filter by status if provided
  if (status) {
    batchJobs = batchJobs.filter(job => job.status === status);
  }
  
  // Apply pagination
  const limitNum = parseInt(limit) || 20;
  const offsetNum = parseInt(offset) || 0;
  const total = batchJobs.length;
  const paginatedJobs = batchJobs.slice(offsetNum, offsetNum + limitNum);
  
  res.json({
    batchJobs: paginatedJobs,
    pagination: {
      total,
      limit: limitNum,
      offset: offsetNum,
      hasMore: offsetNum + limitNum < total
    }
  });
}));

/**
 * Cancel batch job
 * POST /api/batch/:batchId/cancel
 */
router.post('/:batchId/cancel', authenticateToken, asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  
  const batchJob = cancelBatchJob(batchId, req.user.userId, req.user.role);
  
  res.json({
    message: 'Batch job cancelled successfully',
    batchJob: {
      batchId: batchJob.batchId,
      status: batchJob.status,
      processedFiles: batchJob.processedFiles,
      totalFiles: batchJob.totalFiles,
      completedAt: batchJob.completedAt
    }
  });
}));

/**
 * Delete batch job
 * DELETE /api/batch/:batchId
 */
router.delete('/:batchId', authenticateToken, asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  
  deleteBatchJob(batchId, req.user.userId, req.user.role);
  
  res.json({
    message: 'Batch job deleted successfully',
    batchId
  });
}));

/**
 * Get batch processing statistics
 * GET /api/batch/stats
 */
router.get('/stats', authenticateToken, asyncHandler(async (req, res) => {
  const stats = getBatchStats(req.user.userId, req.user.role);
  
  res.json({
    stats
  });
}));

/**
 * Create batch job without starting (for manual control)
 * POST /api/batch/create
 */
router.post('/create', authenticateToken, upload.array('files', 10), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw commonErrors.badRequest('No files provided');
  }
  
  const {
    description = '',
    processInParallel = 'true',
    maxConcurrency = '3',
    notifyOnComplete = 'false'
  } = req.body;
  
  const options = {
    description,
    processInParallel: processInParallel === 'true',
    maxConcurrency: parseInt(maxConcurrency) || 3,
    notifyOnComplete: notifyOnComplete === 'true'
  };
  
  // Create batch job without starting
  const batchJob = await createBatchJob(req.files, req.user.userId, options);
  
  res.status(201).json({
    message: 'Batch job created (not started)',
    batchJob: {
      batchId: batchJob.batchId,
      description: batchJob.description,
      status: batchJob.status,
      totalFiles: batchJob.totalFiles,
      processInParallel: batchJob.processInParallel,
      maxConcurrency: batchJob.maxConcurrency,
      createdAt: batchJob.createdAt
    }
  });
}));

/**
 * Start a created batch job
 * POST /api/batch/:batchId/start
 */
router.post('/:batchId/start', authenticateToken, asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  
  // Verify user owns the batch job
  const batchJob = getBatchJob(batchId, req.user.userId, req.user.role);
  
  if (!batchJob) {
    throw commonErrors.notFound('Batch job');
  }
  
  if (batchJob.status !== 'created') {
    throw commonErrors.badRequest('Batch job already started or completed');
  }
  
  // Start processing
  setImmediate(async () => {
    try {
      await startBatchProcessing(batchId);
    } catch (error) {
      console.error('Batch processing failed:', error);
    }
  });
  
  res.json({
    message: 'Batch processing started',
    batchId,
    status: 'processing'
  });
}));

/**
 * Get batch job results
 * GET /api/batch/:batchId/results
 */
router.get('/:batchId/results', authenticateToken, asyncHandler(async (req, res) => {
  const { batchId } = req.params;
  
  const batchJob = getBatchJob(batchId, req.user.userId, req.user.role);
  
  if (!batchJob) {
    throw commonErrors.notFound('Batch job');
  }
  
  res.json({
    batchId,
    status: batchJob.status,
    results: batchJob.results,
    errors: batchJob.errors,
    summary: {
      totalFiles: batchJob.totalFiles,
      successfulFiles: batchJob.successfulFiles,
      failedFiles: batchJob.failedFiles,
      progress: batchJob.progress
    }
  });
}));

module.exports = router;