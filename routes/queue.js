const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { asyncHandler, commonErrors } = require('../middleware/errorHandler');
const { queueManager } = require('../utils/jobQueue');

const router = express.Router();

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

module.exports = router;