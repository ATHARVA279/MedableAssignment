const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler, commonErrors } = require('../middleware/errorHandler');
const { queueManager } = require('../utils/jobQueue');
const { enhancedProcessingTracker } = require('../utils/enhancedFileProcessor');

const router = express.Router();

router.get('/stats', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }

  const allQueueStats = queueManager.getAllStats();
  
  res.json({
    queues: allQueueStats,
    totalQueues: Object.keys(allQueueStats).length,
    timestamp: new Date().toISOString()
  });
}));

router.get('/:queueName', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }

  const { queueName } = req.params;
  const queue = queueManager.getQueue(queueName);
  
  if (!queue) {
    throw commonErrors.notFound('Queue');
  }

  const stats = queue.getStats();
  const jobs = queue.getJobs({
    status: req.query.status,
    userId: req.query.userId,
    type: req.query.type
  });

  res.json({
    queueName,
    stats,
    jobs: jobs.slice(0, parseInt(req.query.limit) || 50)
  });
}));

router.post('/:queueName/:action', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }

  const { queueName, action } = req.params;
  const queue = queueManager.getQueue(queueName);
  
  if (!queue) {
    throw commonErrors.notFound('Queue');
  }

  if (!['pause', 'resume'].includes(action)) {
    throw commonErrors.badRequest('Invalid action. Use "pause" or "resume"');
  }

  try {
    if (action === 'pause') {
      queue.isProcessing = false;
    } else {
      queue.isProcessing = true;
      setImmediate(() => queue.processQueue());
    }

    res.json({
      success: true,
      message: `Queue ${queueName} ${action}d successfully`,
      queueName,
      action,
      isProcessing: queue.isProcessing
    });

  } catch (error) {
    throw commonErrors.temporaryFailure(`Failed to ${action} queue: ${error.message}`);
  }
}));

router.delete('/:queueName/completed', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }

  const { queueName } = req.params;
  const queue = queueManager.getQueue(queueName);
  
  if (!queue) {
    throw commonErrors.notFound('Queue');
  }

  const beforeCount = queue.completed.length;
  queue.completed = [];
  
  res.json({
    success: true,
    message: `Cleared ${beforeCount} completed jobs from queue ${queueName}`,
    queueName,
    clearedJobs: beforeCount
  });
}));

router.get('/job/:jobId', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }

  const { jobId } = req.params;
  
  let foundJob = null;
  let queueName = null;
  
  for (const [name, queue] of queueManager.queues) {
    const job = queue.getJob(jobId);
    if (job) {
      foundJob = job;
      queueName = name;
      break;
    }
  }

  if (!foundJob) {
    throw commonErrors.notFound('Job');
  }

  res.json({
    job: foundJob.getSummary(),
    queueName,
    fullDetails: {
      data: foundJob.data,
      metadata: foundJob.metadata,
      errors: foundJob.errors,
      result: foundJob.result,
      attemptHistory: foundJob.retryManager?.getStats()
    }
  });
}));

router.post('/job/:jobId/retry', authenticateToken, asyncHandler(async (req, res) => {
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }

  const { jobId } = req.params;
  
  let foundJob = null;
  let queue = null;
  
  for (const [name, q] of queueManager.queues) {
    const job = q.getJob(jobId);
    if (job) {
      foundJob = job;
      queue = q;
      break;
    }
  }

  if (!foundJob) {
    throw commonErrors.notFound('Job');
  }

  if (foundJob.status !== 'failed') {
    throw commonErrors.badRequest('Only failed jobs can be retried');
  }

  try {
    foundJob.prepareRetry();
    
    if (!queue.jobs.has(foundJob.id)) {
      queue.jobs.set(foundJob.id, foundJob);
    }
    
    foundJob.updateStatus('queued');
    
    setImmediate(() => queue.processQueue());

    res.json({
      success: true,
      message: 'Job queued for retry',
      jobId: foundJob.id,
      attempt: foundJob.attempts + 1,
      maxAttempts: foundJob.maxAttempts
    });

  } catch (error) {
    throw commonErrors.badRequest(`Cannot retry job: ${error.message}`);
  }
}));

router.get('/health', asyncHandler(async (req, res) => {
  const allStats = queueManager.getAllStats();
  
  let healthy = true;
  const issues = [];
  
  for (const [queueName, stats] of Object.entries(allStats)) {
    if (stats.processingCount > stats.queueSize + 10) {
      healthy = false;
      issues.push(`Queue ${queueName} has too many processing jobs`);
    }
    
    if (stats.failedJobs > stats.completedJobs * 0.5) {
      healthy = false;
      issues.push(`Queue ${queueName} has high failure rate`);
    }
  }

  res.json({
    healthy,
    issues,
    queues: Object.keys(allStats),
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
}));

module.exports = router;