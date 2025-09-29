const fs = require("fs").promises;
const path = require("path");
const archiver = require("archiver");
const crypto = require("crypto");
const { logger } = require("./logger");
const { cloudinary } = require("./cloudinaryStorage");
const config = require("../config");

class BackupRecovery {
  constructor() {
    this.backupDir = path.join(__dirname, "../backups");
    this.metadataFile = path.join(this.backupDir, "backup-metadata.json");
    this.ensureBackupDirectory();
  }

  async ensureBackupDirectory() {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
    } catch (error) {
      logger.error("Failed to create backup directory", {
        error: error.message,
      });
    }
  }

  async createFullBackup(options = {}) {
    const backupId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `full-backup-${timestamp}`;
    const backupPath = path.join(this.backupDir, `${backupName}.zip`);

    logger.info("Starting full system backup", { backupId, backupName });

    try {
      const cloudinaryFiles = await this.getAllCloudinaryFiles();

      const archive = archiver("zip", { zlib: { level: 9 } });
      const output = require("fs").createWriteStream(backupPath);

      archive.pipe(output);

      const metadata = {
        backupId,
        timestamp: new Date().toISOString(),
        type: "full",
        fileCount: cloudinaryFiles.length,
        files: [],
      };

      let processedFiles = 0;
      for (const file of cloudinaryFiles) {
        try {
          const fileBuffer = await this.downloadCloudinaryFile(file);
          archive.append(fileBuffer, { name: `files/${file.public_id}` });

          metadata.files.push({
            publicId: file.public_id,
            originalName: file.filename || file.public_id,
            size: file.bytes,
            format: file.format,
            resourceType: file.resource_type,
            createdAt: file.created_at,
            secureUrl: file.secure_url,
          });

          processedFiles++;

          if (options.onProgress) {
            options.onProgress(processedFiles, cloudinaryFiles.length);
          }
        } catch (fileError) {
          logger.warn("Failed to backup file", {
            publicId: file.public_id,
            error: fileError.message,
          });
        }
      }

      archive.append(JSON.stringify(metadata, null, 2), {
        name: "metadata.json",
      });

      const systemConfig = {
        version: require("../package.json").version,
        nodeVersion: process.version,
        timestamp: new Date().toISOString(),
        environment: config.server.env,
      };
      archive.append(JSON.stringify(systemConfig, null, 2), {
        name: "system-config.json",
      });

      await new Promise((resolve, reject) => {
        output.on("close", resolve);
        output.on("error", reject);
        archive.on("error", reject);
        archive.finalize();
      });

      const backupBuffer = await fs.readFile(backupPath);
      const checksum = crypto
        .createHash("sha256")
        .update(backupBuffer)
        .digest("hex");

      await this.updateBackupMetadata({
        backupId,
        name: backupName,
        path: backupPath,
        size: backupBuffer.length,
        checksum,
        timestamp: new Date().toISOString(),
        type: "full",
        fileCount: processedFiles,
        status: "completed",
      });

      logger.info("Full backup completed successfully", {
        backupId,
        backupName,
        fileCount: processedFiles,
        size: backupBuffer.length,
        checksum,
      });

      return {
        backupId,
        name: backupName,
        path: backupPath,
        size: backupBuffer.length,
        checksum,
        fileCount: processedFiles,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Full backup failed", { backupId, error: error.message });

      try {
        await fs.unlink(backupPath);
      } catch (cleanupError) {
        logger.warn("Failed to cleanup failed backup file", {
          backupPath,
          error: cleanupError.message,
        });
      }

      throw error;
    }
  }

  /**
   * Create incremental backup (files changed since last backup)
   */
  async createIncrementalBackup(lastBackupTimestamp, options = {}) {
    const backupId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `incremental-backup-${timestamp}`;
    const backupPath = path.join(this.backupDir, `${backupName}.zip`);

    logger.info("Starting incremental backup", {
      backupId,
      backupName,
      since: lastBackupTimestamp,
    });

    try {
      // Get files modified since last backup
      const modifiedFiles = await this.getModifiedCloudinaryFiles(
        lastBackupTimestamp
      );

      if (modifiedFiles.length === 0) {
        logger.info("No files modified since last backup", {
          lastBackupTimestamp,
        });
        return null;
      }

      // Create backup archive
      const archive = archiver("zip", { zlib: { level: 9 } });
      const output = require("fs").createWriteStream(backupPath);

      archive.pipe(output);

      // Add file metadata
      const metadata = {
        backupId,
        timestamp: new Date().toISOString(),
        type: "incremental",
        since: lastBackupTimestamp,
        fileCount: modifiedFiles.length,
        files: [],
      };

      // Process modified files
      let processedFiles = 0;
      for (const file of modifiedFiles) {
        try {
          const fileBuffer = await this.downloadCloudinaryFile(file);
          archive.append(fileBuffer, { name: `files/${file.public_id}` });

          metadata.files.push({
            publicId: file.public_id,
            originalName: file.filename || file.public_id,
            size: file.bytes,
            format: file.format,
            resourceType: file.resource_type,
            createdAt: file.created_at,
            modifiedAt: file.updated_at || file.created_at,
            secureUrl: file.secure_url,
          });

          processedFiles++;

          if (options.onProgress) {
            options.onProgress(processedFiles, modifiedFiles.length);
          }
        } catch (fileError) {
          logger.warn("Failed to backup modified file", {
            publicId: file.public_id,
            error: fileError.message,
          });
        }
      }

      // Add metadata to archive
      archive.append(JSON.stringify(metadata, null, 2), {
        name: "metadata.json",
      });

      // Finalize archive
      await new Promise((resolve, reject) => {
        output.on("close", resolve);
        output.on("error", reject);
        archive.on("error", reject);
        archive.finalize();
      });

      // Calculate backup checksum
      const backupBuffer = await fs.readFile(backupPath);
      const checksum = crypto
        .createHash("sha256")
        .update(backupBuffer)
        .digest("hex");

      // Update backup metadata
      await this.updateBackupMetadata({
        backupId,
        name: backupName,
        path: backupPath,
        size: backupBuffer.length,
        checksum,
        timestamp: new Date().toISOString(),
        type: "incremental",
        since: lastBackupTimestamp,
        fileCount: processedFiles,
        status: "completed",
      });

      logger.info("Incremental backup completed successfully", {
        backupId,
        backupName,
        fileCount: processedFiles,
        size: backupBuffer.length,
      });

      return {
        backupId,
        name: backupName,
        path: backupPath,
        size: backupBuffer.length,
        checksum,
        fileCount: processedFiles,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Incremental backup failed", {
        backupId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(backupId, options = {}) {
    logger.info("Starting restore from backup", { backupId });

    try {
      // Get backup metadata
      const backupInfo = await this.getBackupInfo(backupId);
      if (!backupInfo) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // Verify backup integrity
      const isValid = await this.verifyBackupIntegrity(
        backupInfo.path,
        backupInfo.checksum
      );
      if (!isValid) {
        throw new Error("Backup file integrity check failed");
      }

      // Extract backup
      const extractPath = path.join(this.backupDir, `restore-${backupId}`);
      await this.extractBackup(backupInfo.path, extractPath);

      // Read metadata
      const metadataPath = path.join(extractPath, "metadata.json");
      const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));

      // Restore files to Cloudinary
      let restoredFiles = 0;
      const failedFiles = [];

      for (const fileInfo of metadata.files) {
        try {
          const filePath = path.join(extractPath, "files", fileInfo.publicId);
          const fileBuffer = await fs.readFile(filePath);

          // Upload to Cloudinary with original public_id
          await this.restoreFileToCloudinary(fileBuffer, fileInfo);
          restoredFiles++;

          if (options.onProgress) {
            options.onProgress(restoredFiles, metadata.files.length);
          }
        } catch (fileError) {
          logger.warn("Failed to restore file", {
            publicId: fileInfo.publicId,
            error: fileError.message,
          });
          failedFiles.push({
            publicId: fileInfo.publicId,
            error: fileError.message,
          });
        }
      }

      // Clean up extraction directory
      await this.cleanupDirectory(extractPath);

      logger.info("Restore completed", {
        backupId,
        totalFiles: metadata.files.length,
        restoredFiles,
        failedFiles: failedFiles.length,
      });

      return {
        backupId,
        totalFiles: metadata.files.length,
        restoredFiles,
        failedFiles,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Restore failed", { backupId, error: error.message });
      throw error;
    }
  }

  /**
   * Get all files from Cloudinary
   */
  async getAllCloudinaryFiles() {
    const allFiles = [];
    let nextCursor = null;

    do {
      const options = { max_results: 500 };
      if (nextCursor) {
        options.next_cursor = nextCursor;
      }

      const result = await cloudinary.api.resources(options);
      allFiles.push(...result.resources);
      nextCursor = result.next_cursor;
    } while (nextCursor);

    return allFiles;
  }

  /**
   * Get files modified since timestamp
   */
  async getModifiedCloudinaryFiles(since) {
    // Cloudinary doesn't have direct "modified since" query
    // We'll get all files and filter by created_at
    const allFiles = await this.getAllCloudinaryFiles();
    const sinceDate = new Date(since);

    return allFiles.filter((file) => {
      const fileDate = new Date(file.created_at);
      return fileDate > sinceDate;
    });
  }

  /**
   * Download file from Cloudinary
   */
  async downloadCloudinaryFile(file) {
    const response = await fetch(file.secure_url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Restore file to Cloudinary
   */
  async restoreFileToCloudinary(fileBuffer, fileInfo) {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: fileInfo.publicId,
            resource_type: fileInfo.resourceType,
            overwrite: true,
          },
          (error, result) => {
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          }
        )
        .end(fileBuffer);
    });
  }

  /**
   * Update backup metadata
   */
  async updateBackupMetadata(backupInfo) {
    try {
      let metadata = [];

      try {
        const existingData = await fs.readFile(this.metadataFile, "utf8");
        metadata = JSON.parse(existingData);
      } catch (error) {
        // File doesn't exist yet, start with empty array
      }

      metadata.push(backupInfo);
      await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
      logger.error("Failed to update backup metadata", {
        error: error.message,
      });
    }
  }

  /**
   * Get backup information
   */
  async getBackupInfo(backupId) {
    try {
      const data = await fs.readFile(this.metadataFile, "utf8");
      const metadata = JSON.parse(data);
      return metadata.find((backup) => backup.backupId === backupId);
    } catch (error) {
      return null;
    }
  }

  /**
   * List all backups
   */
  async listBackups() {
    try {
      const data = await fs.readFile(this.metadataFile, "utf8");
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  /**
   * Verify backup integrity
   */
  async verifyBackupIntegrity(backupPath, expectedChecksum) {
    try {
      const backupBuffer = await fs.readFile(backupPath);
      const actualChecksum = crypto
        .createHash("sha256")
        .update(backupBuffer)
        .digest("hex");
      return actualChecksum === expectedChecksum;
    } catch (error) {
      return false;
    }
  }

  /**
   * Extract backup archive
   */
  async extractBackup(backupPath, extractPath) {
    const yauzl = require("yauzl");

    return new Promise((resolve, reject) => {
      yauzl.open(backupPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(err);

        zipfile.readEntry();
        zipfile.on("entry", async (entry) => {
          if (/\/$/.test(entry.fileName)) {
            // Directory entry
            const dirPath = path.join(extractPath, entry.fileName);
            await fs.mkdir(dirPath, { recursive: true });
            zipfile.readEntry();
          } else {
            // File entry
            zipfile.openReadStream(entry, async (err, readStream) => {
              if (err) return reject(err);

              const filePath = path.join(extractPath, entry.fileName);
              await fs.mkdir(path.dirname(filePath), { recursive: true });

              const writeStream = require("fs").createWriteStream(filePath);
              readStream.pipe(writeStream);

              writeStream.on("close", () => {
                zipfile.readEntry();
              });
            });
          }
        });

        zipfile.on("end", resolve);
        zipfile.on("error", reject);
      });
    });
  }

  /**
   * Clean up directory
   */
  async cleanupDirectory(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
    } catch (error) {
      logger.warn("Failed to cleanup directory", {
        dirPath,
        error: error.message,
      });
    }
  }

  /**
   * Schedule automatic backups
   */
  scheduleAutomaticBackups(options = {}) {
    const fullBackupInterval =
      options.fullBackupInterval || 7 * 24 * 60 * 60 * 1000; // 7 days
    const incrementalInterval =
      options.incrementalInterval || 24 * 60 * 60 * 1000; // 1 day

    // Schedule full backups
    setInterval(async () => {
      try {
        logger.info("Starting scheduled full backup");
        await this.createFullBackup();
        logger.info("Scheduled full backup completed");
      } catch (error) {
        logger.error("Scheduled full backup failed", { error: error.message });
      }
    }, fullBackupInterval);

    // Schedule incremental backups
    setInterval(async () => {
      try {
        const backups = await this.listBackups();
        const lastBackup = backups.sort(
          (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        )[0];

        if (lastBackup) {
          logger.info("Starting scheduled incremental backup");
          const result = await this.createIncrementalBackup(
            lastBackup.timestamp
          );
          if (result) {
            logger.info("Scheduled incremental backup completed");
          } else {
            logger.info("No changes since last backup");
          }
        }
      } catch (error) {
        logger.error("Scheduled incremental backup failed", {
          error: error.message,
        });
      }
    }, incrementalInterval);

    logger.info("Automatic backup scheduling enabled", {
      fullBackupInterval: fullBackupInterval / (24 * 60 * 60 * 1000) + " days",
      incrementalInterval: incrementalInterval / (60 * 60 * 1000) + " hours",
    });
  }

  /**
   * Clean up old backups
   */
  async cleanupOldBackups(retentionDays = 30) {
    try {
      const backups = await this.listBackups();
      const cutoffDate = new Date(
        Date.now() - retentionDays * 24 * 60 * 60 * 1000
      );

      const oldBackups = backups.filter(
        (backup) => new Date(backup.timestamp) < cutoffDate
      );

      for (const backup of oldBackups) {
        try {
          await fs.unlink(backup.path);
          logger.info("Deleted old backup", {
            backupId: backup.backupId,
            name: backup.name,
          });
        } catch (error) {
          logger.warn("Failed to delete old backup file", {
            backupId: backup.backupId,
            error: error.message,
          });
        }
      }

      // Update metadata to remove deleted backups
      const remainingBackups = backups.filter(
        (backup) => new Date(backup.timestamp) >= cutoffDate
      );
      await fs.writeFile(
        this.metadataFile,
        JSON.stringify(remainingBackups, null, 2)
      );

      logger.info("Backup cleanup completed", {
        deletedBackups: oldBackups.length,
        remainingBackups: remainingBackups.length,
      });
    } catch (error) {
      logger.error("Backup cleanup failed", { error: error.message });
    }
  }
}

// Global backup recovery instance
const backupRecovery = new BackupRecovery();

module.exports = {
  BackupRecovery,
  backupRecovery,
};
