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

  async downloadCloudinaryFile(file) {
    const response = await fetch(file.secure_url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

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

  async updateBackupMetadata(backupInfo) {
    try {
      let metadata = [];

      try {
        const existingData = await fs.readFile(this.metadataFile, "utf8");
        metadata = JSON.parse(existingData);
      } catch (error) {
      }

      metadata.push(backupInfo);
      await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
      logger.error("Failed to update backup metadata", {
        error: error.message,
      });
    }
  }

  async getBackupInfo(backupId) {
    try {
      const data = await fs.readFile(this.metadataFile, "utf8");
      const metadata = JSON.parse(data);
      return metadata.find((backup) => backup.backupId === backupId);
    } catch (error) {
      return null;
    }
  }

  async listBackups() {
    try {
      const data = await fs.readFile(this.metadataFile, "utf8");
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  async extractBackup(backupPath, extractPath) {
    const yauzl = require("yauzl");

    return new Promise((resolve, reject) => {
      yauzl.open(backupPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) return reject(err);

        zipfile.readEntry();
        zipfile.on("entry", async (entry) => {
          if (/\/$/.test(entry.fileName)) {
            const dirPath = path.join(extractPath, entry.fileName);
            await fs.mkdir(dirPath, { recursive: true });
            zipfile.readEntry();
          } else {
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
}

const backupRecovery = new BackupRecovery();

module.exports = {
  BackupRecovery,
  backupRecovery,
};
