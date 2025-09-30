const express = require("express");
const multer = require("multer");
const { authenticateToken } = require("../middleware/auth");
const { asyncHandler, commonErrors } = require("../middleware/errorHandler");
const {
  createBatchJob,
  startBatchProcessing,
  getBatchJob,
  cancelBatchJob,
} = require("../utils/batchProcessor");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 10,
  },
});

router.post(
  "/upload",
  authenticateToken,
  upload.array("files", 10),
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      throw commonErrors.badRequest("No files provided");
    }

    const {
      description = "",
      processInParallel = "true",
      maxConcurrency = "3",
      notifyOnComplete = "false",
    } = req.body;

    const options = {
      description,
      processInParallel: processInParallel === "true",
      maxConcurrency: parseInt(maxConcurrency) || 3,
      notifyOnComplete: notifyOnComplete === "true",
    };

    const batchJob = await createBatchJob(req.files, req.user.userId, options);

    setImmediate(async () => {
      try {
        await startBatchProcessing(batchJob.batchId);
      } catch (error) {
        console.error("Batch processing failed:", error);
      }
    });

    res.status(201).json({
      message: "Batch upload job created and started",
      batchJob: {
        batchId: batchJob.batchId,
        description: batchJob.description,
        status: batchJob.status,
        totalFiles: batchJob.totalFiles,
        processInParallel: batchJob.processInParallel,
        maxConcurrency: batchJob.maxConcurrency,
        createdAt: batchJob.createdAt,
      },
    });
  })
);

router.get(
  "/:batchId",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { batchId } = req.params;

    const batchJob = getBatchJob(batchId, req.user.userId, req.user.role);

    if (!batchJob) {
      throw commonErrors.notFound("Batch job");
    }

    res.json({
      batchJob,
    });
  })
);

router.post(
  "/:batchId/cancel",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { batchId } = req.params;

    const batchJob = cancelBatchJob(batchId, req.user.userId, req.user.role);

    res.json({
      message: "Batch job cancelled successfully",
      batchJob: {
        batchId: batchJob.batchId,
        status: batchJob.status,
        processedFiles: batchJob.processedFiles,
        totalFiles: batchJob.totalFiles,
        completedAt: batchJob.completedAt,
      },
    });
  })
);

router.get(
  "/:batchId/results",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { batchId } = req.params;

    const batchJob = getBatchJob(batchId, req.user.userId, req.user.role);

    if (!batchJob) {
      throw commonErrors.notFound("Batch job");
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
        progress: batchJob.progress,
      },
    });
  })
);

module.exports = router;