const express = require("express");
const crypto = require("crypto");
const { authenticateToken } = require("../middleware/auth");
const {
  AppError,
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

    res.json({
      message: "File preview authorized",
      fileId: shareData.fileId,
      previewUrl: `/api/upload/${shareData.fileId}/preview`,
      allowDownload: true,
    });
  })
);

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
          fileName: shareData.fileName || "Unknown File",
          fileSize: shareData.fileSize || 0,
          mimetype: shareData.mimetype || "application/octet-stream",
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
          directUrl: shareData.directDownloadUrl || shareData.cloudinaryUrl,
          originalUrl: shareData.cloudinaryUrl,
        });
      }
    }

    userShares.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      shareLinks: userShares,
      shares: userShares,
      total: userShares.length,
      active: userShares.filter((s) => s.isActive && !s.isExpired).length,
      expired: userShares.filter((s) => s.isExpired).length,
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

router.get(
  "/files",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileService } = require("../services/fileService");

    try {
      const result = await fileService.getFilesByUploader(req.user.userId, {
        page: 1,
        limit: 50,
        status: "processed",
      });

      const files = result.files.map((file) => ({
        fileId: file.fileId,
        fileName: file.originalName,
        fileSize: file.size,
        mimetype: file.mimetype,
        uploadedAt: file.uploadedAt,
        status: file.status,
        downloadCount: file.downloadCount || 0,
      }));

      res.json({
        files,
        total: result.pagination.total,
      });
    } catch (error) {
      res.json({
        files: [
          {
            fileId: "file-001",
            fileName: "sample-document.pdf",
            fileSize: 1024000,
            mimetype: "application/pdf",
          },
          {
            fileId: "file-002",
            fileName: "data-export.csv",
            fileSize: 512000,
            mimetype: "text/csv",
          },
          {
            fileId: "file-003",
            fileName: "profile-image.jpg",
            fileSize: 256000,
            mimetype: "image/jpeg",
          },
        ],
        total: 3,
        note: "Sample files for demonstration",
      });
    }
  })
);

router.get(
  "/test-url/:fileId",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;
    const { fileService } = require("../services/fileService");
    const {
      generateDownloadUrl,
      extractPublicIdFromUrl,
    } = require("../utils/cloudinaryStorage");

    try {
      const file = await fileService.getFileById(fileId);

      if (file.uploaderId !== req.user.userId) {
        throw commonErrors.forbidden("You can only test your own files");
      }

      const publicId = extractPublicIdFromUrl(file.secureUrl);
      const downloadUrl = generateDownloadUrl(
        publicId,
        "raw",
        file.originalName
      );

      res.json({
        fileId: file.fileId,
        fileName: file.originalName,
        mimetype: file.mimetype,
        originalUrl: file.secureUrl,
        extractedPublicId: publicId,
        generatedDownloadUrl: downloadUrl,
        urlComparison: {
          hasAttachmentFlag: downloadUrl.includes("fl_attachment"),
          isSecure: downloadUrl.startsWith("https://"),
          domain: downloadUrl.split("/")[2],
        },
      });
    } catch (error) {
      res.status(500).json({
        error: error.message,
        fileId,
      });
    }
  })
);

module.exports = router;
