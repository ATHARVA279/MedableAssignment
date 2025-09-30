const sharp = require('sharp');
const archiver = require('archiver');
const { Readable, PassThrough } = require('stream');
const { logger } = require('./logger');
const { retryOperations } = require('./retryManager');
const { AppError, RetryableError, PermanentError } = require('../middleware/errorHandler');

const COMPRESSION_CONFIG = {
  image: {
    jpeg: {
      quality: 85,
      progressive: true,
      mozjpeg: true,
      optimizeScans: true
    },
    png: {
      quality: 90,
      compressionLevel: 9,
      palette: true,
      adaptiveFiltering: true
    },
    webp: {
      quality: 85,
      effort: 6,
      smartSubsample: true
    },
    minSizeForCompression: 50 * 1024, 
    maxQualityReduction: 0.3, 
    targetCompressionRatio: 0.7 
  },
  pdf: {
    compressionLevel: 6,
    enableZip64: false
  },
  csv: {
    compressionLevel: 6,
    windowBits: 15,
    memLevel: 8
  },
  general: {
    compressionLevel: 6,
    chunkSize: 64 * 1024 
  }
};

class ImageCompressor {
  static async compressImage(buffer, mimetype, options = {}) {
    if (!Buffer.isBuffer(buffer)) {
      throw new PermanentError('Invalid buffer provided for image compression');
    }

    const originalSize = buffer.length;
    const config = { ...COMPRESSION_CONFIG.image, ...options };

    if (originalSize < config.minSizeForCompression) {
      logger.debug('Skipping compression for small image', { 
        originalSize, 
        minSize: config.minSizeForCompression 
      });
      return {
        buffer,
        compressed: false,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1,
        format: mimetype
      };
    }

    try {
      let sharpInstance = sharp(buffer, {
        failOnError: false,
        limitInputPixels: 268402689
      });

      const metadata = await sharpInstance.metadata();
      logger.debug('Image compression started', {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        originalSize,
        mimetype
      });

      let compressedBuffer;
      let outputFormat = metadata.format;

      switch (mimetype) {
        case 'image/jpeg':
          compressedBuffer = await sharpInstance
            .jpeg({
              quality: config.jpeg.quality,
              progressive: config.jpeg.progressive,
              mozjpeg: config.jpeg.mozjpeg,
              optimizeScans: config.jpeg.optimizeScans
            })
            .toBuffer();
          outputFormat = 'jpeg';
          break;

        case 'image/png':
          compressedBuffer = await sharpInstance
            .png({
              quality: config.png.quality,
              compressionLevel: config.png.compressionLevel,
              palette: config.png.palette,
              adaptiveFiltering: config.png.adaptiveFiltering
            })
            .toBuffer();
          outputFormat = 'png';
          break;

        case 'image/webp':
          compressedBuffer = await sharpInstance
            .webp({
              quality: config.webp.quality,
              effort: config.webp.effort,
              smartSubsample: config.webp.smartSubsample
            })
            .toBuffer();
          outputFormat = 'webp';
          break;

        case 'image/gif':
          compressedBuffer = await sharpInstance
            .png({
              quality: config.png.quality,
              compressionLevel: config.png.compressionLevel
            })
            .toBuffer();
          outputFormat = 'png';
          break;

        default:
          throw new PermanentError(`Unsupported image format for compression: ${mimetype}`);
      }

      const compressedSize = compressedBuffer.length;
      const compressionRatio = compressedSize / originalSize;

      if (compressionRatio > (1 - config.maxQualityReduction)) {
        logger.debug('Compression not effective, using original', {
          originalSize,
          compressedSize,
          compressionRatio,
          threshold: 1 - config.maxQualityReduction
        });
        
        return {
          buffer,
          compressed: false,
          originalSize,
          compressedSize: originalSize,
          compressionRatio: 1,
          format: mimetype,
          reason: 'Insufficient compression ratio'
        };
      }

      logger.info('Image compression successful', {
        originalSize,
        compressedSize,
        compressionRatio: compressionRatio.toFixed(3),
        sizeSaved: originalSize - compressedSize,
        outputFormat
      });

      return {
        buffer: compressedBuffer,
        compressed: true,
        originalSize,
        compressedSize,
        compressionRatio,
        format: `image/${outputFormat}`,
        sizeSaved: originalSize - compressedSize
      };

    } catch (error) {
      logger.error('Image compression failed', {
        error: error.message,
        originalSize,
        mimetype
      });

      if (error.message.includes('Input buffer contains unsupported image format')) {
        throw new PermanentError(`Unsupported or corrupted image format: ${mimetype}`);
      }

      throw new RetryableError(`Image compression failed: ${error.message}`);
    }
  }

  static async generateThumbnail(buffer, mimetype, options = {}) {
    const { width = 300, height = 300, quality = 80 } = options;

    try {
      const thumbnailBuffer = await sharp(buffer)
        .resize(width, height, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality })
        .toBuffer();

      return {
        buffer: thumbnailBuffer,
        width,
        height,
        size: thumbnailBuffer.length,
        format: 'image/jpeg'
      };

    } catch (error) {
      logger.error('Thumbnail generation failed', {
        error: error.message,
        mimetype,
        width,
        height
      });
      throw new RetryableError(`Thumbnail generation failed: ${error.message}`);
    }
  }
}

class ArchiveCompressor {
  static async compressFile(buffer, filename, mimetype, options = {}) {
    if (!Buffer.isBuffer(buffer)) {
      throw new PermanentError('Invalid buffer provided for file compression');
    }

    const originalSize = buffer.length;
    const config = { ...COMPRESSION_CONFIG.pdf, ...options };

    try {
      return new Promise((resolve, reject) => {
        const archive = archiver('zip', {
          zlib: { level: config.compressionLevel }
        });

        const chunks = [];
        const outputStream = new PassThrough();

        outputStream.on('data', chunk => chunks.push(chunk));
        outputStream.on('end', () => {
          const compressedBuffer = Buffer.concat(chunks);
          const compressedSize = compressedBuffer.length;
          const compressionRatio = compressedSize / originalSize;

          if (compressionRatio > 0.95) {
            logger.debug('File compression not effective, using original', {
              filename,
              originalSize,
              compressedSize,
              compressionRatio
            });
            
            resolve({
              buffer,
              compressed: false,
              originalSize,
              compressedSize: originalSize,
              compressionRatio: 1,
              format: mimetype,
              reason: 'Insufficient compression ratio'
            });
          } else {
            logger.info('File compression successful', {
              filename,
              originalSize,
              compressedSize,
              compressionRatio: compressionRatio.toFixed(3),
              sizeSaved: originalSize - compressedSize
            });

            resolve({
              buffer: compressedBuffer,
              compressed: true,
              originalSize,
              compressedSize,
              compressionRatio,
              format: 'application/zip',
              sizeSaved: originalSize - compressedSize,
              archiveContents: [filename]
            });
          }
        });

        archive.on('error', (error) => {
          logger.error('Archive compression failed', {
            error: error.message,
            filename,
            originalSize
          });
          reject(new RetryableError(`Archive compression failed: ${error.message}`));
        });

        archive.pipe(outputStream);
        archive.append(buffer, { name: filename });
        archive.finalize();
      });

    } catch (error) {
      logger.error('File compression failed', {
        error: error.message,
        filename,
        originalSize,
        mimetype
      });
      throw new RetryableError(`File compression failed: ${error.message}`);
    }
  }
}

class CsvCompressor {
  static async compressCsv(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer)) {
      throw new PermanentError('Invalid buffer provided for CSV compression');
    }

    const originalSize = buffer.length;
    const config = { ...COMPRESSION_CONFIG.csv, ...options };

    try {
      const zlib = require('zlib');
      const compressedBuffer = await promisify(zlib.gzip)(buffer, {
        level: config.compressionLevel,
        windowBits: config.windowBits,
        memLevel: config.memLevel
      });

      const compressedSize = compressedBuffer.length;
      const compressionRatio = compressedSize / originalSize;

      if (compressionRatio > 0.8) {
        logger.debug('CSV compression not effective, using original', {
          originalSize,
          compressedSize,
          compressionRatio
        });
        
        return {
          buffer,
          compressed: false,
          originalSize,
          compressedSize: originalSize,
          compressionRatio: 1,
          format: 'text/csv',
          reason: 'Insufficient compression ratio'
        };
      }

      logger.info('CSV compression successful', {
        originalSize,
        compressedSize,
        compressionRatio: compressionRatio.toFixed(3),
        sizeSaved: originalSize - compressedSize
      });

      return {
        buffer: compressedBuffer,
        compressed: true,
        originalSize,
        compressedSize,
        compressionRatio,
        format: 'application/gzip',
        sizeSaved: originalSize - compressedSize
      };

    } catch (error) {
      logger.error('CSV compression failed', {
        error: error.message,
        originalSize
      });
      throw new RetryableError(`CSV compression failed: ${error.message}`);
    }
  }
}

class FileCompressor {
  static async compressFile(buffer, filename, mimetype, options = {}) {
    const context = {
      operationName: 'File Compression',
      filename,
      mimetype,
      originalSize: buffer.length
    };

    return retryOperations.fileProcessing(async () => {
      logger.debug('Starting file compression', context);

      let result;
      
      if (mimetype.startsWith('image/')) {
        result = await ImageCompressor.compressImage(buffer, mimetype, options);
      } else if (mimetype === 'text/csv') {
        result = await CsvCompressor.compressCsv(buffer, options);
      } else if (mimetype === 'application/pdf') {
        result = await ArchiveCompressor.compressFile(buffer, filename, mimetype, options);
      } else {
        result = await ArchiveCompressor.compressFile(buffer, filename, mimetype, options);
      }

      result.filename = filename;
      result.originalMimetype = mimetype;
      result.compressedAt = new Date().toISOString();

      return result;
    }, context);
  }

  static async generateThumbnail(buffer, mimetype, options = {}) {
    const context = {
      operationName: 'Thumbnail Generation',
      mimetype,
      originalSize: buffer.length
    };

    return retryOperations.fileProcessing(async () => {
      if (mimetype.startsWith('image/')) {
        return ImageCompressor.generateThumbnail(buffer, mimetype, options);
      } else {
        throw new PermanentError(`Thumbnail generation not supported for ${mimetype}`);
      }
    }, context);
  }

  static isCompressionSupported(mimetype) {
    const supportedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf',
      'text/csv'
    ];

    return supportedTypes.includes(mimetype);
  }
}

module.exports = {
  FileCompressor,
  ImageCompressor,
  ArchiveCompressor,
  CsvCompressor,
  COMPRESSION_CONFIG
};