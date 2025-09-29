const axios = require('axios');
const sharp = require('sharp');
const csvParser = require('csv-parser');
const pdfParse = require('pdf-parse');
const { fileTypeFromBuffer } = require('file-type');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);
const { generateThumbnailUrl } = require('./fileStorage');
const { logger } = require('./logger');
const { retryOperations } = require('./retryManager');
const { RetryableError, PermanentError } = require('../middleware/errorHandler');
const { FileCompressor } = require('./fileCompression');
const { queueManager, JOB_TYPES, JOB_PRIORITIES } = require('./jobQueue');

const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; 
const STREAM_CSV_ROW_PROGRESS_INTERVAL = 1000;

class EnhancedProcessingTracker {
  constructor() {
    this.jobs = new Map();
    this.queue = queueManager.getQueue('processing', {
      concurrency: 3,
      maxJobs: 500
    });
    
    this.registerProcessors();
  }

  registerProcessors() {
    this.queue.registerProcessor(JOB_TYPES.FILE_PROCESSING, this.processFileJob.bind(this));
    this.queue.registerProcessor(JOB_TYPES.FILE_COMPRESSION, this.compressFileJob.bind(this));
    this.queue.registerProcessor(JOB_TYPES.THUMBNAIL_GENERATION, this.generateThumbnailJob.bind(this));
  }

  async processFileJob(data, job) {
    const { fileData, cloudinaryResult, compressionEnabled = true } = data;
    
    try {
      job.updateStatus('processing', { progress: 10 });
      
      const processingResult = await this.processFileWithRetry(fileData, cloudinaryResult);
      
      job.updateStatus('processing', { progress: 70 });
      
      if (compressionEnabled && FileCompressor.isCompressionSupported(fileData.mimetype)) {
        const compressionResult = await this.compressFileWithRetry(
          cloudinaryResult.buffer || await this.fetchBuffer(cloudinaryResult.secureUrl),
          fileData.originalName,
          fileData.mimetype
        );
        
        processingResult.compression = compressionResult;
      }
      
      job.updateStatus('processing', { progress: 90 });
      
      if (fileData.mimetype.startsWith('image/')) {
        try {
          const thumbnailResult = await this.generateThumbnailWithRetry(
            cloudinaryResult.buffer || await this.fetchBuffer(cloudinaryResult.secureUrl),
            fileData.mimetype
          );
          processingResult.thumbnail = thumbnailResult;
        } catch (thumbnailError) {
          logger.warn('Thumbnail generation failed, continuing without thumbnail', {
            error: thumbnailError.message,
            fileId: fileData.id
          });
        }
      }
      
      job.updateStatus('processing', { progress: 100 });
      
      return processingResult;
      
    } catch (error) {
      logger.error('File processing job failed', {
        error: error.message,
        fileId: fileData.id,
        attempts: job.attempts
      });
      throw error;
    }
  }

  async compressFileJob(data, job) {
    const { buffer, filename, mimetype, options = {} } = data;
    
    job.updateStatus('processing', { progress: 20 });
    
    const result = await FileCompressor.compressFile(buffer, filename, mimetype, options);
    
    job.updateStatus('processing', { progress: 100 });
    
    return result;
  }

  async generateThumbnailJob(data, job) {
    const { buffer, mimetype, options = {} } = data;
    
    job.updateStatus('processing', { progress: 50 });
    
    const result = await FileCompressor.generateThumbnail(buffer, mimetype, options);
    
    job.updateStatus('processing', { progress: 100 });
    
    return result;
  }

  async startJob(fileId, fileData, cloudinaryResult, options = {}) {
    const jobData = {
      fileData: { ...fileData, id: fileId },
      cloudinaryResult,
      ...options
    };

    const jobId = await this.queue.addJob(
      JOB_TYPES.FILE_PROCESSING,
      jobData,
      {
        userId: fileData.uploaderId,
        priority: options.priority || JOB_PRIORITIES.NORMAL,
        maxAttempts: options.maxAttempts || 3,
        metadata: {
          fileId,
          originalName: fileData.originalName,
          mimetype: fileData.mimetype,
          timeout: options.timeout || 300000 // 5 minutes
        }
      }
    );

    // Store job reference
    this.jobs.set(fileId, {
      jobId,
      fileId,
      status: 'queued',
      startTime: Date.now(),
      progress: 0
    });

    logger.info('Processing job queued', {
      fileId,
      jobId,
      originalName: fileData.originalName,
      mimetype: fileData.mimetype
    });

    return jobId;
  }

  async processFileWithRetry(fileData, cloudinaryResult) {
    const context = {
      operationName: 'File Processing',
      fileId: fileData.id,
      mimetype: fileData.mimetype,
      originalName: fileData.originalName
    };

    return retryOperations.fileProcessing(async () => {
      return this.processFileInternal(fileData, cloudinaryResult);
    }, context);
  }

  async compressFileWithRetry(buffer, filename, mimetype) {
    const context = {
      operationName: 'File Compression',
      filename,
      mimetype,
      size: buffer.length
    };

    return retryOperations.fileProcessing(async () => {
      return FileCompressor.compressFile(buffer, filename, mimetype);
    }, context);
  }

  async generateThumbnailWithRetry(buffer, mimetype) {
    const context = {
      operationName: 'Thumbnail Generation',
      mimetype,
      size: buffer.length
    };

    return retryOperations.fileProcessing(async () => {
      return FileCompressor.generateThumbnail(buffer, mimetype);
    }, context);
  }

  async processFileInternal(fileData, cloudinaryResult) {
    const { mimetype, originalName } = fileData;

    let processingResult = {
      processedAt: new Date().toISOString(),
      originalName,
      mimetype,
      publicId: cloudinaryResult.publicId,
      secureUrl: cloudinaryResult.secureUrl,
      size: cloudinaryResult.size,
      format: cloudinaryResult.format
    };

    // Basic validation
    if (!cloudinaryResult.size || cloudinaryResult.size === 0) {
      throw new PermanentError('Uploaded file has zero size');
    }

    // Route based on mimetype
    try {
      if (mimetype && mimetype.startsWith('image/')) {
        processingResult = await this.processImageWithRetry(cloudinaryResult, processingResult);
      } else if (mimetype === 'application/pdf') {
        processingResult = await this.processPDFWithRetry(cloudinaryResult, processingResult);
      } else if ([
        'text/csv',
        'application/csv',
        'application/vnd.ms-excel',
        'text/plain'
      ].includes(mimetype)) {
        processingResult = await this.processCSVWithRetry(cloudinaryResult, processingResult);
      } else {
        throw new PermanentError(`Unsupported MIME type: ${mimetype}`);
      }

      return {
        status: 'processed',
        result: processingResult
      };

    } catch (error) {
      logger.error('File processing failed', {
        error: error.message,
        originalName,
        mimetype,
        publicId: cloudinaryResult?.publicId
      });

      return {
        status: 'failed',
        result: {
          error: error.message,
          processedAt: new Date().toISOString(),
          publicId: cloudinaryResult?.publicId,
          secureUrl: cloudinaryResult?.secureUrl
        }
      };
    }
  }

  async processImageWithRetry(cloudinaryResult, baseResult) {
    const context = {
      operationName: 'Image Processing',
      publicId: cloudinaryResult.publicId
    };

    return retryOperations.fileProcessing(async () => {
      return this.processImageInternal(cloudinaryResult, baseResult);
    }, context);
  }

  async processPDFWithRetry(cloudinaryResult, baseResult) {
    const context = {
      operationName: 'PDF Processing',
      publicId: cloudinaryResult.publicId
    };

    return retryOperations.fileProcessing(async () => {
      return this.processPDFInternal(cloudinaryResult, baseResult);
    }, context);
  }

  async processCSVWithRetry(cloudinaryResult, baseResult) {
    const context = {
      operationName: 'CSV Processing',
      publicId: cloudinaryResult.publicId
    };

    return retryOperations.fileProcessing(async () => {
      return this.processCSVInternal(cloudinaryResult, baseResult);
    }, context);
  }

  async processImageInternal(cloudinaryResult, baseResult) {
    try {
      if (!cloudinaryResult || !cloudinaryResult.publicId) {
        throw new PermanentError('Invalid Cloudinary result - missing publicId');
      }

      let width = cloudinaryResult.width || null;
      let height = cloudinaryResult.height || null;
      let format = cloudinaryResult.format || baseResult.format || null;
      let thumbnailUrl = null;
      let buffer = null;

      // If width/height missing or we need to generate a thumbnail locally -> fetch buffer
      const needBuffer = !width || !height || !cloudinaryResult.format;
      if (needBuffer) {
        buffer = await this.fetchBufferWithRetry(cloudinaryResult.secureUrl, 20 * 1024 * 1024);
        
        const valid = await this.validateBufferType(buffer, 'image/*');
        if (!valid) {
          logger.warn('Image buffer type validation failed', { publicId: cloudinaryResult.publicId });
        } else {
          const metadata = await sharp(buffer).metadata();
          width = width || metadata.width || null;
          height = height || metadata.height || null;
          format = format || metadata.format || format;
        }
      }

      // Try to generate thumbnail URL using Cloudinary transformation
      try {
        thumbnailUrl = generateThumbnailUrl(cloudinaryResult.publicId, {
          width: 200,
          height: 200,
          crop: 'fill',
          quality: 'auto'
        });
      } catch (thumbnailError) {
        logger.warn('Failed to generate thumbnail URL', {
          publicId: cloudinaryResult.publicId,
          error: thumbnailError.message
        });
        
        // Fallback: generate local thumbnail if we have buffer
        if (buffer) {
          try {
            const thumbBuffer = await sharp(buffer).resize(200, 200, { fit: 'cover' }).toBuffer();
            const base64 = thumbBuffer.toString('base64');
            thumbnailUrl = `data:image/${format};base64,${base64}`;
          } catch (e) {
            logger.warn('Local thumbnail generation failed', { error: e.message });
          }
        }
      }

      return {
        ...baseResult,
        width,
        height,
        format,
        thumbnailGenerated: !!thumbnailUrl,
        thumbnailUrl,
        resourceType: cloudinaryResult.resourceType || 'image'
      };

    } catch (error) {
      logger.error('Image processing failed', {
        error: error.message,
        publicId: cloudinaryResult?.publicId
      });

      // Determine if error is retryable
      if (error.message.includes('timeout') || error.message.includes('network')) {
        throw new RetryableError(`Image processing failed: ${error.message}`);
      }

      return {
        ...baseResult,
        width: null,
        height: null,
        format: baseResult.format,
        thumbnailGenerated: false,
        thumbnailUrl: null,
        resourceType: 'image',
        processingError: error.message
      };
    }
  }

  async processPDFInternal(cloudinaryResult, baseResult) {
    try {
      if (!cloudinaryResult || !cloudinaryResult.secureUrl) {
        throw new PermanentError('Invalid Cloudinary result for PDF');
      }

      const declaredSize = cloudinaryResult.size || null;
      const MAX_PDF_BYTES = 40 * 1024 * 1024; // 40 MB
      
      if (declaredSize && declaredSize > MAX_PDF_BYTES) {
        throw new PermanentError(`PDF too large to process (${declaredSize} bytes). Max is ${MAX_PDF_BYTES}`);
      }

      const buffer = await this.fetchBufferWithRetry(cloudinaryResult.secureUrl, MAX_PDF_BYTES);

      // Validate file is PDF
      const valid = await this.validateBufferType(buffer, 'application/pdf');
      if (!valid) {
        throw new PermanentError('Buffer is not a valid PDF');
      }

      const pdfData = await pdfParse(buffer);

      return {
        ...baseResult,
        pages: pdfData.numpages || 0,
        wordCount: this.estimateWordCount(pdfData.text || ''),
        textExtracted: !!(pdfData.text && pdfData.text.trim()),
        hasText: !!(pdfData.text && pdfData.text.trim()),
        resourceType: cloudinaryResult.resourceType || 'raw'
      };

    } catch (error) {
      logger.error('PDF processing failed', {
        error: error.message,
        publicId: cloudinaryResult?.publicId
      });

      // Determine if error is retryable
      if (error.message.includes('timeout') || error.message.includes('network') || 
          error.message.includes('corrupted') || error.message.includes('invalid')) {
        if (error.message.includes('corrupted') || error.message.includes('invalid')) {
          throw new PermanentError(`PDF processing failed: ${error.message}`);
        } else {
          throw new RetryableError(`PDF processing failed: ${error.message}`);
        }
      }

      return {
        ...baseResult,
        pages: 0,
        wordCount: 0,
        textExtracted: false,
        hasText: false,
        resourceType: 'raw',
        processingError: error.message
      };
    }
  }

  async processCSVInternal(cloudinaryResult, baseResult) {
    try {
      if (!cloudinaryResult || !cloudinaryResult.secureUrl) {
        throw new PermanentError('Invalid Cloudinary result for CSV');
      }

      const stream = await this.fetchStreamWithRetry(cloudinaryResult.secureUrl);
      
      let rowCount = 0;
      let columnCount = 0;
      let columns = [];
      const sampleRows = [];
      let hasSensitiveData = false;

      return new Promise((resolve, reject) => {
        const parser = csvParser({
          skipEmptyLines: true,
          skipLinesWithError: true
        });

        let headerProcessed = false;

        parser.on('headers', (headers) => {
          columns = headers || [];
          columnCount = columns.length;
          headerProcessed = true;
          
          // Check for potentially sensitive columns
          const sensitivePatterns = ['password', 'ssn', 'social', 'credit', 'card', 'phone', 'email'];
          hasSensitiveData = columns.some(col => 
            sensitivePatterns.some(pattern => 
              col.toLowerCase().includes(pattern)
            )
          );
        });

        parser.on('data', (row) => {
          rowCount++;
          
          if (sampleRows.length < 3) {
            sampleRows.push(row);
          }

          // Progress reporting
          if (rowCount % STREAM_CSV_ROW_PROGRESS_INTERVAL === 0) {
            logger.debug('CSV processing progress', {
              publicId: cloudinaryResult.publicId,
              rowsProcessed: rowCount
            });
          }
        });

        parser.on('end', () => {
          resolve({
            ...baseResult,
            rowCount,
            columnCount,
            columns,
            hasSensitiveData,
            sampleRowCount: sampleRows.length,
            resourceType: cloudinaryResult.resourceType || 'raw'
          });
        });

        parser.on('error', (error) => {
          logger.error('CSV parsing error', {
            error: error.message,
            publicId: cloudinaryResult.publicId,
            rowsProcessed: rowCount
          });

          if (error.message.includes('Invalid record') || error.message.includes('Malformed')) {
            reject(new PermanentError(`CSV parsing failed: ${error.message}`));
          } else {
            reject(new RetryableError(`CSV processing failed: ${error.message}`));
          }
        });

        stream.pipe(parser);
      });

    } catch (error) {
      logger.error('CSV processing failed', {
        error: error.message,
        publicId: cloudinaryResult?.publicId
      });

      if (error.message.includes('timeout') || error.message.includes('network')) {
        throw new RetryableError(`CSV processing failed: ${error.message}`);
      }

      return {
        ...baseResult,
        rowCount: 0,
        columnCount: 0,
        columns: [],
        hasSensitiveData: false,
        sampleRowCount: 0,
        resourceType: 'raw',
        processingError: error.message
      };
    }
  }

  async fetchStreamWithRetry(url, maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES) {
    const context = {
      operationName: 'Fetch Stream',
      url: url.substring(0, 100) + '...',
      maxBytes
    };

    return retryOperations.network(async () => {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000
      });

      const contentLength = response.headers['content-length']
        ? parseInt(response.headers['content-length'], 10)
        : null;

      if (contentLength && contentLength > maxBytes) {
        response.data.destroy();
        throw new PermanentError(`Remote file is too large: ${contentLength} bytes (max ${maxBytes})`);
      }

      return response.data;
    }, context);
  }

  async fetchBufferWithRetry(url, maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES) {
    const context = {
      operationName: 'Fetch Buffer',
      url: url.substring(0, 100) + '...',
      maxBytes
    };

    return retryOperations.network(async () => {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000
      });

      const contentLength = response.headers['content-length']
        ? parseInt(response.headers['content-length'], 10)
        : null;

      if (contentLength && contentLength > maxBytes) {
        response.data.destroy();
        throw new PermanentError(`Remote file is too large: ${contentLength} bytes (max ${maxBytes})`);
      }

      const chunks = [];
      let downloaded = 0;

      return new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          downloaded += chunk.length;
          if (downloaded > maxBytes) {
            response.data.destroy();
            return reject(new PermanentError(`Download exceeded max size of ${maxBytes} bytes`));
          }
          chunks.push(chunk);
        });

        response.data.on('end', () => resolve(Buffer.concat(chunks)));
        response.data.on('error', (err) => {
          if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
            reject(new RetryableError(`Network error: ${err.message}`));
          } else {
            reject(err);
          }
        });
      });
    }, context);
  }

  async validateBufferType(buffer, expectedMime) {
    try {
      const ft = await fileTypeFromBuffer(buffer);
      if (!ft) {
        logger.warn('File-type unknown from buffer');
        return false;
      }
      if (expectedMime && !ft.mime.startsWith(expectedMime.split('/')[0])) {
        logger.warn('File type mismatch', { expectedMime, detected: ft.mime });
        return false;
      }
      return true;
    } catch (error) {
      logger.error('Buffer type validation failed', { error: error.message });
      return false;
    }
  }

  estimateWordCount(text) {
    if (!text || typeof text !== 'string') return 0;
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  getJob(fileId) {
    const job = this.jobs.get(fileId);
    if (job) {
      const queueJob = this.queue.getJob(job.jobId);
      if (queueJob) {
        job.status = queueJob.status;
        job.progress = queueJob.progress;
        job.error = queueJob.errors.length > 0 ? queueJob.errors[queueJob.errors.length - 1] : null;
      }
    }
    return job;
  }

  getAllJobs() {
    return Array.from(this.jobs.values()).map(job => {
      const queueJob = this.queue.getJob(job.jobId);
      if (queueJob) {
        return {
          ...job,
          status: queueJob.status,
          progress: queueJob.progress,
          attempts: queueJob.attempts,
          errors: queueJob.errors
        };
      }
      return job;
    });
  }

  cancelJob(fileId) {
    const job = this.jobs.get(fileId);
    if (job && job.jobId) {
      return this.queue.cancelJob(job.jobId);
    }
    throw new Error('Job not found');
  }

  getQueueStats() {
    return this.queue.getStats();
  }

  cleanupOldJobs() {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();

    for (const [fileId, job] of this.jobs.entries()) {
      if (job.endTime && (now - job.endTime) > maxAge) {
        this.jobs.delete(fileId);
      }
    }
  }
}

const enhancedProcessingTracker = new EnhancedProcessingTracker();

async function processFile(fileData, cloudinaryResult) {
  const fileId = fileData.id || cloudinaryResult.publicId || 'temp-' + Date.now();
  
  const jobId = await enhancedProcessingTracker.startJob(fileId, fileData, cloudinaryResult);
  
  return new Promise((resolve, reject) => {
    const checkJob = () => {
      const job = enhancedProcessingTracker.getJob(fileId);
      if (!job) {
        reject(new Error('Job not found'));
        return;
      }

      if (job.status === 'completed') {
        resolve(job.result);
      } else if (job.status === 'failed') {
        reject(new Error(job.error?.message || 'Processing failed'));
      } else {
        setTimeout(checkJob, 1000);
      }
    };

    checkJob();
  });
}

setInterval(() => {
  enhancedProcessingTracker.cleanupOldJobs();
}, 60 * 60 * 1000); 

module.exports = {
  processFile,
  EnhancedProcessingTracker,
  enhancedProcessingTracker,
  processingTracker: enhancedProcessingTracker
};