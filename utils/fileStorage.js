const config = require("../config");
const { logger } = require("./logger");

const cloudinaryStorage = require("./cloudinaryStorage");

async function saveFile(fileBuffer, originalName, mimetype, options = {}) {
  try {
    if (config.storage.type === "cloudinary") {
      return await cloudinaryStorage.uploadToCloudinary(
        fileBuffer,
        originalName,
        mimetype,
        options
      );
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error("File save failed", {
      error: error.message,
      originalName,
      mimetype,
      storageType: config.storage.type,
    });
    throw error;
  }
}

async function deleteFile(fileIdentifier, resourceType = "auto") {
  try {
    if (config.storage.type === "cloudinary") {
      return await cloudinaryStorage.deleteFromCloudinary(
        fileIdentifier,
        resourceType
      );
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error("File soft deletion failed", {
      error: error.message,
      fileIdentifier,
      storageType: config.storage.type,
    });
    throw error;
  }
}

async function permanentDeleteFile(fileIdentifier, resourceType = "auto") {
  try {
    if (config.storage.type === "cloudinary") {
      return await cloudinaryStorage.permanentDeleteFromCloudinary(
        fileIdentifier,
        resourceType
      );
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error("File permanent deletion failed", {
      error: error.message,
      fileIdentifier,
      storageType: config.storage.type,
    });
    throw error;
  }
}

async function restoreFile(deletedFileIdentifier, originalFileIdentifier, resourceType = "auto") {
  try {
    if (config.storage.type === "cloudinary") {
      return await cloudinaryStorage.restoreFromDeleted(
        deletedFileIdentifier,
        originalFileIdentifier,
        resourceType
      );
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error("File restoration failed", {
      error: error.message,
      deletedFileIdentifier,
      originalFileIdentifier,
      storageType: config.storage.type,
    });
    throw error;
  }
}

async function getFileStats(fileIdentifier, resourceType = "auto") {
  try {
    if (config.storage.type === "cloudinary") {
      return await cloudinaryStorage.getFileMetadata(
        fileIdentifier,
        resourceType
      );
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error("Failed to get file stats", {
      error: error.message,
      fileIdentifier,
      storageType: config.storage.type,
    });
    throw error;
  }
}

function generateThumbnailUrl(fileIdentifier, options = {}) {
  if (config.storage.type === "cloudinary") {
    return cloudinaryStorage.generateThumbnailUrl(fileIdentifier, options);
  } else {
    throw new Error(
      `Thumbnail generation not supported for storage type: ${config.storage.type}`
    );
  }
}

async function initializeStorage() {
  try {
    if (config.storage.type === "cloudinary") {
      const isConfigured = cloudinaryStorage.isCloudinaryConfigured();
      if (!isConfigured) {
        throw new Error("Cloudinary credentials not configured");
      }

      const connectionTest = await cloudinaryStorage.testCloudinaryConnection();
      if (!connectionTest) {
        throw new Error("Cloudinary connection test failed");
      }

      logger.info("Cloudinary storage initialized successfully");
      return true;
    } else {
      throw new Error(`Unsupported storage type: ${config.storage.type}`);
    }
  } catch (error) {
    logger.error("Storage initialization failed", {
      error: error.message,
      storageType: config.storage.type,
    });
    throw error;
  }
}

module.exports = {
  saveFile,
  deleteFile,
  permanentDeleteFile,
  restoreFile,
  getFileStats,
  generateThumbnailUrl,
  initializeStorage,
};
