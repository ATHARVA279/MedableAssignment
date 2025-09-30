const express = require("express");
const multer = require("multer");
const { authenticateToken } = require("../middleware/auth");
const {
  AppError,
  asyncHandler,
  commonErrors,
} = require("../middleware/errorHandler");
const { virusScanner } = require("../utils/virusScanner");
const { inputSanitizer } = require("../utils/inputSanitizer");
const { logger } = require("../utils/logger");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 1,
  },
});

router.post(
  "/file",
  authenticateToken,
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw commonErrors.badRequest("No file provided for scanning");
    }

    const { buffer, originalname, mimetype, size } = req.file;

    const sanitizedFilename = inputSanitizer.sanitizeText(originalname, 255);

    logger.info("Manual virus scan requested", {
      userId: req.user.userId,
      filename: sanitizedFilename,
      size,
      scanner: "virustotal",
      ip: req.ip,
    });

    try {
      const scanResult = await virusScanner.scanFile(
        buffer,
        sanitizedFilename,
        {
          scanner: "virustotal",
          userId: req.user.userId,
        }
      );

      logger.info("Manual virus scan completed", {
        userId: req.user.userId,
        filename: sanitizedFilename,
        scanId: scanResult.scanId,
        clean: scanResult.clean,
        threatsFound: scanResult.threats.length,
        scanner: scanResult.scanner,
        duration: scanResult.duration,
      });

      res.json({
        success: true,
        scanId: scanResult.scanId,
        filename: sanitizedFilename,
        fileSize: size,
        mimetype,
        scanResult: {
          clean: scanResult.clean,
          scanner: scanResult.scanner,
          duration: scanResult.duration,
          timestamp: scanResult.timestamp,
          threats: scanResult.threats,
          metadata: scanResult.metadata,
        },
      });
    } catch (error) {
      logger.error("Manual virus scan failed", {
        userId: req.user.userId,
        filename: sanitizedFilename,
        error: error.message,
        ip: req.ip,
      });

      throw new AppError(`Virus scan failed: ${error.message}`, 500);
    }
  })
);

module.exports = router;