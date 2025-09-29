const express = require("express");
const crypto = require("crypto");
const { authenticateToken } = require("../middleware/auth");
const {
  AppError,
  asyncHandler,
  commonErrors,
} = require("../middleware/errorHandler");

const router = express.Router();

// In-memory storage for share links (use database in production)
const shareLinks = new Map();

// Default expiration times
const EXPIRATION_OPTIONS = {
  "1h": 60 * 60 * 1000, // 1 hour
  "24h": 24 * 60 * 60 * 1000, // 24 hours
  "7d": 7 * 24 * 60 * 60 * 1000, // 7 days
  "30d": 30 * 24 * 60 * 60 * 1000, // 30 days
};

/**
 * Generate secure share token
 */
function generateShareToken() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Check if share link is expired
 */
function isExpired(shareData) {
  return Date.now() > shareData.expiresAt;
}

/**
 * Clean up expired share links
 */
function cleanupExpiredLinks() {
  const now = Date.now();
  for (const [token, shareData] of shareLinks.entries()) {
    if (now > shareData.expiresAt) {
      shareLinks.delete(token);
    }
  }
}

// Clean up expired links every hour
setInterval(cleanupExpiredLinks, 60 * 60 * 1000);

/**
 * Create share link for file
 * POST /api/sharing/:fileId
 */
router.post(
  "/:fileId",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;
    const {
      expiresIn = "24h",
      password,
      maxDownloads = null,
      allowPreview = true,
    } = req.body;

    // Validate expiration time
    if (!EXPIRATION_OPTIONS[expiresIn]) {
      throw commonErrors.badRequest(
        `Invalid expiration time. Allowed: ${Object.keys(
          EXPIRATION_OPTIONS
        ).join(", ")}`
      );
    }

    // TODO: Verify user owns the file (would need to check against file storage)
    // For now, we'll assume the file exists and user has access

    const shareToken = generateShareToken();
    const expiresAt = Date.now() + EXPIRATION_OPTIONS[expiresIn];

    const shareData = {
      token: shareToken,
      fileId,
      createdBy: req.user.userId,
      createdAt: Date.now(),
      expiresAt,
      expiresIn,
      password: password
        ? crypto.createHash("sha256").update(password).digest("hex")
        : null,
      maxDownloads,
      downloadCount: 0,
      allowPreview,
      isActive: true,
    };

    shareLinks.set(shareToken, shareData);

    res.status(201).json({
      message: "Share link created successfully",
      shareLink: {
        token: shareToken,
        url: `${req.protocol}://${req.get(
          "host"
        )}/api/sharing/download/${shareToken}`,
        expiresAt: new Date(expiresAt).toISOString(),
        expiresIn,
        maxDownloads,
        allowPreview,
        hasPassword: !!password,
      },
    });
  })
);

/**
 * Get share link info
 * GET /api/sharing/:token/info
 */
router.get(
  "/:token/info",
  asyncHandler(async (req, res) => {
    const { token } = req.params;

    const shareData = shareLinks.get(token);

    if (!shareData) {
      throw commonErrors.notFound("Share link");
    }

    if (isExpired(shareData)) {
      shareLinks.delete(token);
      throw commonErrors.notFound("Share link has expired");
    }

    if (!shareData.isActive) {
      throw commonErrors.forbidden("Share link has been deactivated");
    }

    res.json({
      fileId: shareData.fileId,
      expiresAt: new Date(shareData.expiresAt).toISOString(),
      expiresIn: shareData.expiresIn,
      maxDownloads: shareData.maxDownloads,
      downloadCount: shareData.downloadCount,
      allowPreview: shareData.allowPreview,
      hasPassword: !!shareData.password,
      isExpired: false,
      remainingDownloads: shareData.maxDownloads
        ? shareData.maxDownloads - shareData.downloadCount
        : null,
    });
  })
);

/**
 * Download file via share link
 * GET /api/sharing/download/:token
 */
router.get(
  "/download/:token",
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { password } = req.query;

    const shareData = shareLinks.get(token);

    if (!shareData) {
      throw commonErrors.notFound("Share link");
    }

    if (isExpired(shareData)) {
      shareLinks.delete(token);
      throw commonErrors.notFound("Share link has expired");
    }

    if (!shareData.isActive) {
      throw commonErrors.forbidden("Share link has been deactivated");
    }

    // Check password if required
    if (shareData.password) {
      if (!password) {
        return res.status(401).json({
          error: "Password required",
          requiresPassword: true,
        });
      }

      const hashedPassword = crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
      if (hashedPassword !== shareData.password) {
        throw commonErrors.unauthorized("Invalid password");
      }
    }

    // Check download limit
    if (
      shareData.maxDownloads &&
      shareData.downloadCount >= shareData.maxDownloads
    ) {
      throw commonErrors.forbidden("Download limit exceeded");
    }

    // Increment download count
    shareData.downloadCount++;

    // TODO: In real implementation, serve the actual file
    // For now, return file info and download URL
    res.json({
      message: "File download authorized",
      fileId: shareData.fileId,
      downloadUrl: `/api/upload/${shareData.fileId}/download`,
      downloadCount: shareData.downloadCount,
      remainingDownloads: shareData.maxDownloads
        ? shareData.maxDownloads - shareData.downloadCount
        : null,
    });
  })
);

/**
 * Preview file via share link (if allowed)
 * GET /api/sharing/preview/:token
 */
router.get(
  "/preview/:token",
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { password } = req.query;

    const shareData = shareLinks.get(token);

    if (!shareData) {
      throw commonErrors.notFound("Share link");
    }

    if (isExpired(shareData)) {
      shareLinks.delete(token);
      throw commonErrors.notFound("Share link has expired");
    }

    if (!shareData.isActive) {
      throw commonErrors.forbidden("Share link has been deactivated");
    }

    if (!shareData.allowPreview) {
      throw commonErrors.forbidden("Preview not allowed for this share link");
    }

    // Check password if required
    if (shareData.password) {
      if (!password) {
        return res.status(401).json({
          error: "Password required",
          requiresPassword: true,
        });
      }

      const hashedPassword = crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
      if (hashedPassword !== shareData.password) {
        throw commonErrors.unauthorized("Invalid password");
      }
    }

    // TODO: In real implementation, return file preview/metadata
    res.json({
      message: "File preview authorized",
      fileId: shareData.fileId,
      previewUrl: `/api/upload/${shareData.fileId}/preview`,
      allowDownload: true,
    });
  })
);

/**
 * List user's share links
 * GET /api/sharing
 */
router.get(
  "/",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const userShares = [];

    for (const [token, shareData] of shareLinks.entries()) {
      if (shareData.createdBy === req.user.userId) {
        userShares.push({
          token,
          fileId: shareData.fileId,
          createdAt: new Date(shareData.createdAt).toISOString(),
          expiresAt: new Date(shareData.expiresAt).toISOString(),
          expiresIn: shareData.expiresIn,
          downloadCount: shareData.downloadCount,
          maxDownloads: shareData.maxDownloads,
          allowPreview: shareData.allowPreview,
          hasPassword: !!shareData.password,
          isActive: shareData.isActive,
          isExpired: isExpired(shareData),
          url: `${req.protocol}://${req.get(
            "host"
          )}/api/sharing/download/${token}`,
        });
      }
    }

    // Sort by creation date (newest first)
    userShares.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      shares: userShares,
      total: userShares.length,
      active: userShares.filter((s) => s.isActive && !s.isExpired).length,
      expired: userShares.filter((s) => s.isExpired).length,
    });
  })
);

/**
 * Update share link
 * PUT /api/sharing/:token
 */
router.put(
  "/:token",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { isActive, maxDownloads, allowPreview } = req.body;

    const shareData = shareLinks.get(token);

    if (!shareData) {
      throw commonErrors.notFound("Share link");
    }

    if (shareData.createdBy !== req.user.userId) {
      throw commonErrors.forbidden("You can only modify your own share links");
    }

    // Update allowed fields
    if (typeof isActive === "boolean") {
      shareData.isActive = isActive;
    }

    if (typeof maxDownloads === "number" && maxDownloads > 0) {
      shareData.maxDownloads = maxDownloads;
    }

    if (typeof allowPreview === "boolean") {
      shareData.allowPreview = allowPreview;
    }

    res.json({
      message: "Share link updated successfully",
      shareLink: {
        token,
        isActive: shareData.isActive,
        maxDownloads: shareData.maxDownloads,
        allowPreview: shareData.allowPreview,
      },
    });
  })
);

/**
 * Delete share link
 * DELETE /api/sharing/:token
 */
router.delete(
  "/:token",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { token } = req.params;

    const shareData = shareLinks.get(token);

    if (!shareData) {
      throw commonErrors.notFound("Share link");
    }

    if (shareData.createdBy !== req.user.userId && req.user.role !== "admin") {
      throw commonErrors.forbidden("You can only delete your own share links");
    }

    shareLinks.delete(token);

    res.json({
      message: "Share link deleted successfully",
    });
  })
);

module.exports = router;
