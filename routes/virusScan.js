const express = require('express');
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const { AppError, asyncHandler, commonErrors } = require('../middleware/errorHandler');
const { virusScanner } = require('../utils/virusScanner');
const { inputSanitizer } = require('../utils/inputSanitizer');
const { logger } = require('../utils/logger');

const router = express.Router();

// Configure multer for virus scan uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB for scanning
    files: 1
  }
});

/**
 * Scan uploaded file with VirusTotal
 * POST /api/virus-scan/file
 */
router.post('/file', authenticateToken, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw commonErrors.badRequest('No file provided for scanning');
  }

  const { buffer, originalname, mimetype, size } = req.file;
  const { scanner = 'virustotal' } = req.body;

  // Sanitize inputs
  const sanitizedFilename = inputSanitizer.sanitizeText(originalname, 255);
  const sanitizedScanner = inputSanitizer.sanitizeText(scanner, 20);

  logger.info('Manual virus scan requested', {
    userId: req.user.userId,
    filename: sanitizedFilename,
    size,
    scanner: sanitizedScanner,
    ip: req.ip
  });

  try {
    // Perform virus scan
    const scanResult = await virusScanner.scanFile(buffer, sanitizedFilename, {
      scanner: sanitizedScanner,
      userId: req.user.userId
    });

    // Log scan result
    logger.info('Manual virus scan completed', {
      userId: req.user.userId,
      filename: sanitizedFilename,
      scanId: scanResult.scanId,
      clean: scanResult.clean,
      threatsFound: scanResult.threats.length,
      scanner: scanResult.scanner,
      duration: scanResult.duration
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
        metadata: scanResult.metadata
      }
    });

  } catch (error) {
    logger.error('Manual virus scan failed', {
      userId: req.user.userId,
      filename: sanitizedFilename,
      error: error.message,
      ip: req.ip
    });

    throw new AppError(`Virus scan failed: ${error.message}`, 500);
  }
}));

/**
 * Scan file by hash (VirusTotal only)
 * POST /api/virus-scan/hash
 */
router.post('/hash', authenticateToken, asyncHandler(async (req, res) => {
  const { fileHash } = req.body;

  if (!fileHash) {
    throw commonErrors.badRequest('File hash is required');
  }

  // Validate hash format (SHA256 should be 64 hex characters)
  const sanitizedHash = inputSanitizer.sanitizeText(fileHash, 64);
  if (!/^[a-fA-F0-9]{64}$/.test(sanitizedHash)) {
    throw commonErrors.badRequest('Invalid SHA256 hash format');
  }

  logger.info('Hash-based virus scan requested', {
    userId: req.user.userId,
    fileHash: sanitizedHash,
    ip: req.ip
  });

  try {
    // Check VirusTotal API directly for hash
    const apiKey = process.env.VIRUSTOTAL_API_KEY;
    if (!apiKey) {
      throw new Error('VirusTotal API key not configured');
    }

    const response = await fetch(`https://www.virustotal.com/vtapi/v2/file/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        apikey: apiKey,
        resource: sanitizedHash
      })
    });

    const result = await response.json();
    
    if (result.response_code === 0) {
      return res.json({
        success: true,
        fileHash: sanitizedHash,
        found: false,
        message: 'File hash not found in VirusTotal database'
      });
    }

    if (result.response_code === -2) {
      return res.json({
        success: true,
        fileHash: sanitizedHash,
        found: true,
        status: 'queued',
        message: 'File is queued for analysis'
      });
    }

    // Parse results
    const threats = [];
    if (result.positives > 0 && result.scans) {
      Object.entries(result.scans).forEach(([engine, scan]) => {
        if (scan.detected) {
          threats.push({
            engine,
            result: scan.result,
            version: scan.version,
            update: scan.update
          });
        }
      });
    }

    logger.info('Hash-based virus scan completed', {
      userId: req.user.userId,
      fileHash: sanitizedHash,
      clean: result.positives === 0,
      threatsFound: result.positives
    });

    res.json({
      success: true,
      fileHash: sanitizedHash,
      found: true,
      scanResult: {
        clean: result.positives === 0,
        positives: result.positives,
        total: result.total,
        scanDate: result.scan_date,
        threats,
        permalink: result.permalink,
        md5: result.md5,
        sha1: result.sha1,
        sha256: result.sha256
      }
    });

  } catch (error) {
    logger.error('Hash-based virus scan failed', {
      userId: req.user.userId,
      fileHash: sanitizedHash,
      error: error.message,
      ip: req.ip
    });

    throw new AppError(`Hash scan failed: ${error.message}`, 500);
  }
}));

/**
 * Get scanner health status
 * GET /api/virus-scan/health
 */
router.get('/health', authenticateToken, asyncHandler(async (req, res) => {
  logger.info('Scanner health check requested', {
    userId: req.user.userId,
    ip: req.ip
  });

  try {
    const healthStatus = await virusScanner.getHealthStatus();
    
    res.json({
      success: true,
      health: healthStatus
    });

  } catch (error) {
    logger.error('Scanner health check failed', {
      userId: req.user.userId,
      error: error.message,
      ip: req.ip
    });

    throw new AppError(`Health check failed: ${error.message}`, 500);
  }
}));

/**
 * Get scan statistics (admin only)
 * GET /api/virus-scan/stats
 */
router.get('/stats', authenticateToken, asyncHandler(async (req, res) => {
  // Check if user is admin
  if (req.user.role !== 'admin') {
    throw commonErrors.forbidden('Admin access required');
  }

  // In a real implementation, you'd query your database for stats
  // For now, return mock statistics
  const stats = {
    totalScans: 1250,
    cleanFiles: 1198,
    threatsDetected: 52,
    scanners: {
      virustotal: {
        scans: 800,
        threats: 35,
        avgResponseTime: 2500
      },
      clamav: {
        scans: 400,
        threats: 15,
        avgResponseTime: 800
      },
      mock: {
        scans: 50,
        threats: 2,
        avgResponseTime: 100
      }
    },
    topThreats: [
      { name: 'Trojan.GenKryptik', count: 12 },
      { name: 'Adware.Generic', count: 8 },
      { name: 'PUA.Win32.Packer', count: 6 }
    ],
    lastUpdated: new Date().toISOString()
  };

  res.json({
    success: true,
    statistics: stats
  });
}));

module.exports = router;