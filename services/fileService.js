const File = require("../models/File");
const { logger } = require("../utils/logger");
const { AppError } = require("../middleware/errorHandler");

class FileService {
  async createFile(fileData) {
    try {
      const file = new File(fileData);
      await file.save();

      logger.info("File record created", {
        fileId: file.fileId,
        originalName: file.originalName,
        uploaderId: file.uploaderId,
      });

      return file;
    } catch (error) {
      logger.error("Failed to create file record", {
        error: error.message,
        fileData: { ...fileData, buffer: "[BUFFER]" },
      });

      if (error.code === 11000) {
        throw new AppError("File with this ID already exists", 409);
      }

      throw new AppError(`Failed to create file record: ${error.message}`, 500);
    }
  }

  async getFileById(fileId, includeDeleted = false) {
    try {
      const query = { fileId };
      if (!includeDeleted) {
        query.status = { $ne: "deleted" };
      }

      const file = await File.findOne(query);

      if (!file) {
        throw new AppError("File not found", 404);
      }

      return file;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Failed to get file by ID", {
        fileId,
        error: error.message,
      });

      throw new AppError(`Failed to retrieve file: ${error.message}`, 500);
    }
  }

  async getFilesByUploader(uploaderId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        mimetype,
        publicAccess,
        search,
      } = options;

      const skip = (page - 1) * limit;

      let query = File.findByUploader(uploaderId, {
        status,
        mimetype,
        publicAccess,
        limit,
        skip,
      });

      if (search) {
        const searchRegex = new RegExp(search, "i");
        query = query.where({
          $or: [
            { originalName: searchRegex },
            { description: searchRegex },
            { tags: { $in: [searchRegex] } },
          ],
        });
      }

      const files = await query.exec();
      const total = await File.countDocuments({
        uploaderId,
        status: { $ne: "deleted" },
        ...(status && { status }),
        ...(mimetype && { mimetype }),
        ...(publicAccess !== undefined && { publicAccess }),
      });

      return {
        files,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Failed to get files by uploader", {
        uploaderId,
        options,
        error: error.message,
      });

      throw new AppError(`Failed to retrieve files: ${error.message}`, 500);
    }
  }

  async getPublicFiles(options = {}) {
    try {
      const { page = 1, limit = 20, mimetype, search } = options;

      const skip = (page - 1) * limit;

      let query = File.findPublicFiles({
        mimetype,
        limit,
        skip,
      });

      if (search) {
        const searchRegex = new RegExp(search, "i");
        query = query.where({
          $or: [
            { originalName: searchRegex },
            { description: searchRegex },
            { tags: { $in: [searchRegex] } },
          ],
        });
      }

      const files = await query.exec();
      const total = await File.countDocuments({
        publicAccess: true,
        status: "processed",
        ...(mimetype && { mimetype }),
      });

      return {
        files,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Failed to get public files", {
        options,
        error: error.message,
      });

      throw new AppError(
        `Failed to retrieve public files: ${error.message}`,
        500
      );
    }
  }

  async updateFile(fileId, updateData) {
    try {
      const file = await this.getFileById(fileId);

      const allowedUpdates = [
        "originalName",
        "description",
        "tags",
        "publicAccess",
        "status",
        "processingResult",
        "encryptionMeta",
        "virusScanResult",
        "backupStatus",
        "lastBackup",
      ];

      allowedUpdates.forEach((field) => {
        if (updateData[field] !== undefined) {
          file[field] = updateData[field];
        }
      });

      await file.save();

      logger.info("File updated", {
        fileId,
        updatedFields: Object.keys(updateData),
      });

      return file;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Failed to update file", {
        fileId,
        updateData,
        error: error.message,
      });

      throw new AppError(`Failed to update file: ${error.message}`, 500);
    }
  }

  async updateProcessingStatus(fileId, status, result = null) {
    try {
      const file = await this.getFileById(fileId);
      await file.updateProcessingStatus(status, result);

      logger.info("File processing status updated", {
        fileId,
        status,
        hasResult: !!result,
      });

      return file;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Failed to update processing status", {
        fileId,
        status,
        error: error.message,
      });

      throw new AppError(
        `Failed to update processing status: ${error.message}`,
        500
      );
    }
  }

  async deleteFile(fileId) {
    try {
      const file = await this.getFileById(fileId);
      await file.softDelete();

      logger.info("File soft deleted", { fileId });

      return file;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Failed to delete file", {
        fileId,
        error: error.message,
      });

      throw new AppError(`Failed to delete file: ${error.message}`, 500);
    }
  }

  async incrementDownload(fileId) {
    try {
      const file = await this.getFileById(fileId);
      await file.incrementDownload();

      return file;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Failed to increment download count", {
        fileId,
        error: error.message,
      });

      throw new AppError(
        `Failed to update download count: ${error.message}`,
        500
      );
    }
  }

  async searchFiles(searchTerm, uploaderId = null, options = {}) {
    try {
      const { page = 1, limit = 20 } = options;

      const skip = (page - 1) * limit;

      const files = await File.searchFiles(searchTerm, uploaderId, {
        limit,
        skip,
      });

      const searchRegex = new RegExp(searchTerm, "i");
      let countQuery = {
        status: { $ne: "deleted" },
        $or: [
          { originalName: searchRegex },
          { description: searchRegex },
          { tags: { $in: [searchRegex] } },
        ],
      };

      if (uploaderId) {
        countQuery.uploaderId = uploaderId;
      } else {
        countQuery.publicAccess = true;
      }

      const total = await File.countDocuments(countQuery);

      return {
        files,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Failed to search files", {
        searchTerm,
        uploaderId,
        options,
        error: error.message,
      });

      throw new AppError(`Failed to search files: ${error.message}`, 500);
    }
  }

  async getFileStats(uploaderId = null) {
    try {
      const matchStage = uploaderId
        ? { uploaderId, status: { $ne: "deleted" } }
        : { status: { $ne: "deleted" } };

      const stats = await File.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalFiles: { $sum: 1 },
            totalSize: { $sum: "$size" },
            avgSize: { $avg: "$size" },
            totalDownloads: { $sum: "$downloadCount" },
            statusBreakdown: {
              $push: "$status",
            },
            mimetypeBreakdown: {
              $push: "$mimetype",
            },
          },
        },
      ]);

      if (stats.length === 0) {
        return {
          totalFiles: 0,
          totalSize: 0,
          avgSize: 0,
          totalDownloads: 0,
          statusBreakdown: {},
          mimetypeBreakdown: {},
        };
      }

      const result = stats[0];

      result.statusBreakdown = result.statusBreakdown.reduce((acc, status) => {
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});

      result.mimetypeBreakdown = result.mimetypeBreakdown.reduce(
        (acc, mimetype) => {
          acc[mimetype] = (acc[mimetype] || 0) + 1;
          return acc;
        },
        {}
      );

      return result;
    } catch (error) {
      logger.error("Failed to get file statistics", {
        uploaderId,
        error: error.message,
      });

      throw new AppError(
        `Failed to get file statistics: ${error.message}`,
        500
      );
    }
  }

  async getFileVersions(parentFileId) {
    try {
      const versions = await File.find({
        $or: [{ fileId: parentFileId }, { parentFileId: parentFileId }],
        status: { $ne: "deleted" },
      }).sort({ version: 1 });

      return versions;
    } catch (error) {
      logger.error("Failed to get file versions", {
        parentFileId,
        error: error.message,
      });

      throw new AppError(`Failed to get file versions: ${error.message}`, 500);
    }
  }

  async createShareToken(fileId, expiryHours = 24, password = null) {
    try {
      const file = await this.getFileById(fileId);
      await file.createShareToken(expiryHours, password);

      logger.info("Share token created", {
        fileId,
        expiryHours,
        hasPassword: !!password,
      });

      return file;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Failed to create share token", {
        fileId,
        error: error.message,
      });

      throw new AppError(`Failed to create share token: ${error.message}`, 500);
    }
  }

  async getFileByShareToken(shareToken) {
    try {
      const file = await File.findOne({ shareToken });

      if (!file) {
        throw new AppError("Invalid share token", 404);
      }

      if (!file.isShareValid()) {
        throw new AppError("Share token has expired", 410);
      }

      return file;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error("Failed to get file by share token", {
        shareToken,
        error: error.message,
      });

      throw new AppError(
        `Failed to retrieve shared file: ${error.message}`,
        500
      );
    }
  }
}

const fileService = new FileService();

module.exports = {
  FileService,
  fileService,
};
