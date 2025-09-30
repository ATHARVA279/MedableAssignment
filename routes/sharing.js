const express = require("express");
const crypto = require("crypto");
const { authenticateToken } = require("../middleware/auth");
const {
  asyncHandler,
  commonErrors,
} = require("../middleware/errorHandler");

const router = express.Router();

const shareLinks = new Map();

const EXPIRATION_OPTIONS = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function generateShareToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isExpired(shareData) {
  return Date.now() > shareData.expiresAt;
}

function cleanupExpiredLinks() {
  const now = Date.now();
  for (const [token, shareData] of shareLinks.entries()) {
    if (now > shareData.expiresAt) {
      shareLinks.delete(token);
    }
  }
}

setInterval(cleanupExpiredLinks, 60 * 60 * 1000);

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

    if (!EXPIRATION_OPTIONS[expiresIn]) {
      throw commonErrors.badRequest(
        `Invalid expiration time. Allowed: ${Object.keys(
          EXPIRATION_OPTIONS
        ).join(", ")}`
      );
    }

    const { fileService } = require("../services/fileService");
    let file;
    try {
      file = await fileService.getFileById(fileId);

      if (file.uploaderId !== req.user.userId) {
        throw commonErrors.forbidden("You can only share your own files");
      }
    } catch (error) {
      if (error.statusCode === 404) {
        throw commonErrors.notFound("File not found");
      }
      throw error;
    }

    const shareToken = generateShareToken();
    const expiresAt = Date.now() + EXPIRATION_OPTIONS[expiresIn];

    let directDownloadUrl = file.secureUrl;

    if (
      file.mimetype === "application/pdf" ||
      !file.mimetype.startsWith("image/")
    ) {
      const {
        generateDownloadUrl,
        extractPublicIdFromUrl,
      } = require("../utils/cloudinaryStorage");

      try {
        const publicId = extractPublicIdFromUrl(file.secureUrl);

        directDownloadUrl = generateDownloadUrl(
          publicId,
          "raw",
          file.originalName
        );
      } catch (error) {
        directDownloadUrl = file.secureUrl;
      }
    }

    const shareData = {
      token: shareToken,
      fileId,
      fileName: file.originalName,
      fileSize: file.size,
      mimetype: file.mimetype,
      cloudinaryUrl: file.secureUrl,
      directDownloadUrl,
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
        directUrl: directDownloadUrl,
        originalUrl: file.secureUrl,
        fileName: file.originalName,
        fileSize: file.size,
        expiresAt: new Date(expiresAt).toISOString(),
        expiresIn,
        maxDownloads,
        allowPreview,
        hasPassword: !!password,
      },
    });
  })
);

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

    if (
      shareData.maxDownloads &&
      shareData.downloadCount >= shareData.maxDownloads
    ) {
      throw commonErrors.forbidden("Download limit exceeded");
    }

    shareData.downloadCount++;

    if (shareData.cloudinaryUrl) {
      let downloadUrl = shareData.directDownloadUrl || shareData.cloudinaryUrl;

      if (
        !shareData.directDownloadUrl &&
        (shareData.mimetype === "application/pdf" ||
          !shareData.mimetype.startsWith("image/"))
      ) {
        const {
          generateDownloadUrl,
          extractPublicIdFromUrl,
        } = require("../utils/cloudinaryStorage");

        try {
          const publicId = extractPublicIdFromUrl(shareData.cloudinaryUrl);
          downloadUrl = generateDownloadUrl(
            publicId,
            "raw",
            shareData.fileName
          );
        } catch (error) {
          downloadUrl = shareData.cloudinaryUrl;
        }
      }

      res.set({
        "Content-Disposition": `attachment; filename="${shareData.fileName}"`,
        "Content-Type": shareData.mimetype || "application/octet-stream",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });

      return res.redirect(downloadUrl);
    }

    res.json({
      message: "File download authorized",
      fileId: shareData.fileId,
      fileName: shareData.fileName,
      fileSize: shareData.fileSize,
      mimetype: shareData.mimetype,
      directDownloadUrl: shareData.cloudinaryUrl,
      downloadCount: shareData.downloadCount,
      remainingDownloads: shareData.maxDownloads
        ? shareData.maxDownloads - shareData.downloadCount
        : null,
      note: "Use directDownloadUrl for immediate download",
    });
  })
);

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
