// file: fileProcessor.js
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

const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const STREAM_CSV_ROW_PROGRESS_INTERVAL = 1000; // update progress every N rows

/**
 * Fetch a readable stream from a URL (axios). Enforces a maximum size (via headers + counted bytes)
 * Returns axios response stream
 */
async function fetchStream(url, maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES) {
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    // 30s timeout by default - you can tune
    timeout: 30000
  });

  const contentLength = response.headers['content-length']
    ? parseInt(response.headers['content-length'], 10)
    : null;

  if (contentLength && contentLength > maxBytes) {
    response.data.destroy();
    throw new Error(`Remote file is too large: ${contentLength} bytes (max ${maxBytes})`);
  }

  // enforce max bytes while streaming (count bytes manually downstream if needed)
  return response.data;
}

/**
 * Fetch a buffer for a URL, with size limit. Useful for pdf-parse and sharp.
 */
async function fetchBuffer(url, maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES) {
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
    throw new Error(`Remote file is too large: ${contentLength} bytes (max ${maxBytes})`);
  }

  const chunks = [];
  let downloaded = 0;

  return new Promise((resolve, reject) => {
    response.data.on('data', (chunk) => {
      downloaded += chunk.length;
      if (downloaded > maxBytes) {
        response.data.destroy();
        return reject(new Error(`Download exceeded max size of ${maxBytes} bytes`));
      }
      chunks.push(chunk);
    });

    response.data.on('end', () => resolve(Buffer.concat(chunks)));
    response.data.on('error', (err) => reject(err));
  });
}

/**
 * Validate file magic number/type for downloaded buffer
 */
async function validateBufferType(buffer, expectedMime) {
  const ft = await fileTypeFromBuffer(buffer);
  if (!ft) {
    // unknown type
    logger.warn('File-type unknown from buffer');
    return false;
  }
  if (expectedMime && !ft.mime.startsWith(expectedMime.split('/')[0])) {
    // e.g., expected image/* but got application/pdf
    logger.warn('File type mismatch', { expectedMime, detected: ft.mime });
    return false;
  }
  return true;
}

/**
 * Fetch a sample of file headers (first bytes) to guess type without full download
 */
async function detectTypeFromUrl(url, maxPeek = 8192) {
  // we will get a small buffer of bytes
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 15000,
    headers: {
      Range: `bytes=0-${maxPeek - 1}`
    }
  });

  const chunks = [];
  response.data.on('data', (chunk) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    response.data.on('end', async () => {
      const buf = Buffer.concat(chunks);
      const ft = await fileTypeFromBuffer(buf);
      resolve(ft ? ft.mime : null);
    });
    response.data.on('error', (err) => reject(err));
  });
}

/**
 * Main processFile orchestration
 */
async function processFile(fileData, cloudinaryResult) {
  const { mimetype, originalName } = fileData;

  try {
    let processingResult = {
      processedAt: new Date().toISOString(),
      originalName,
      mimetype,
      publicId: cloudinaryResult.publicId,
      secureUrl: cloudinaryResult.secureUrl,
      size: cloudinaryResult.size,
      format: cloudinaryResult.format
    };

    // Basic validation: zero-byte
    if (!cloudinaryResult.size || cloudinaryResult.size === 0) {
      throw new Error('Uploaded file has zero size');
    }

    // Route based on mimetype
    if (mimetype && mimetype.startsWith('image/')) {
      processingResult = await processImage(cloudinaryResult, processingResult);
    } else if (mimetype === 'application/pdf') {
      processingResult = await processPDF(cloudinaryResult, processingResult);
    } else if ([
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'text/plain'
    ].includes(mimetype)) {
      processingResult = await processCSV(cloudinaryResult, processingResult);
    } else {
      // Unknown / unsupported - error early
      throw new Error(`Unsupported MIME type: ${mimetype}`);
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

    // Update tracker if we have an id
    if (cloudinaryResult?.publicId && processingTracker.getJob(cloudinaryResult.publicId)) {
      processingTracker.failJob(cloudinaryResult.publicId, error);
    }

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

/**
 * Process image files. Uses cloudinary metadata when available, otherwise fetches buffer and uses sharp.
 */
async function processImage(cloudinaryResult, baseResult) {
  try {
    if (!cloudinaryResult || !cloudinaryResult.publicId) {
      throw new Error('Invalid Cloudinary result - missing publicId');
    }

    let width = cloudinaryResult.width || null;
    let height = cloudinaryResult.height || null;
    let format = cloudinaryResult.format || baseResult.format || null;
    let thumbnailUrl = null;
    let buffer = null;

    // If width/height missing or we need to generate a thumbnail locally -> fetch buffer
    const needBuffer = !width || !height || !cloudinaryResult.format;
    if (needBuffer) {
      // Limit buffer size to 20MB for images
      buffer = await fetchBuffer(cloudinaryResult.secureUrl, 20 * 1024 * 1024);
      // validate buffer type (ensure image)
      const valid = await validateBufferType(buffer, 'image/*');
      if (!valid) {
        logger.warn('Image buffer type validation failed', { publicId: cloudinaryResult.publicId });
      } else {
        const metadata = await sharp(buffer).metadata();
        width = width || metadata.width || null;
        height = height || metadata.height || null;
        format = format || metadata.format || format;
      }
    }

    // Try to generate thumbnail URL using Cloudinary transformation (preferred)
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
      // fallback: if we have a buffer, generate a local data-url thumbnail (optional)
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
      cloudinaryResult: cloudinaryResult ? {
        publicId: cloudinaryResult.publicId,
        resourceType: cloudinaryResult.resourceType
      } : 'null'
    });

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

/**
 * Process PDF - use pdf-parse to get page count and word count.
 * For very large PDFs we enforce a maximum buffer size.
 */
async function processPDF(cloudinaryResult, baseResult) {
  try {
    if (!cloudinaryResult || !cloudinaryResult.secureUrl) {
      throw new Error('Invalid Cloudinary result for PDF');
    }

    const declaredSize = cloudinaryResult.size || null;
    // If declared size is > max, reject early
    const MAX_PDF_BYTES = 40 * 1024 * 1024; // 40 MB
    if (declaredSize && declaredSize > MAX_PDF_BYTES) {
      throw new Error(`PDF too large to process (${declaredSize} bytes). Max is ${MAX_PDF_BYTES}`);
    }

    const buffer = await fetchBuffer(cloudinaryResult.secureUrl, MAX_PDF_BYTES);

    // validate file is PDF
    const ft = await fileTypeFromBuffer(buffer);
    if (!ft || ft.mime !== 'application/pdf') {
      logger.warn('Downloaded file for PDF processing was not detected as PDF', { publicId: cloudinaryResult.publicId, detected: ft?.mime });
    }

    // pdf-parse gives text, number of pages, etc.
    const data = await pdfParse(buffer, { max: 10 * 1024 * 1024 }); // some option, but pdf-parse reads full buffer
    const text = data.text || '';
    const wordCount = text ? text.trim().split(/\s+/).length : 0;
    const pages = data.numpages || data.numPages || (data.metadata && data.metadata.pages) || null;
    // detect images presence (approx)
    const hasText = wordCount > 0;
    const hasImages = (data.metadata && /image/i.test(String(data.metadata))) || false;

    return {
      ...baseResult,
      pages,
      wordCount,
      textExtracted: false, // intentionally not returning text
      hasText,
      hasImages,
      resourceType: cloudinaryResult.resourceType || 'raw'
    };
  } catch (error) {
    throw new Error(`PDF processing failed: ${error.message}`);
  }
}

/**
 * Process CSV streaming - uses csv-parser to avoid loading full file into memory.
 */
async function processCSV(cloudinaryResult, baseResult) {
  try {
    if (!cloudinaryResult || !cloudinaryResult.secureUrl) {
      throw new Error('Invalid Cloudinary result for CSV');
    }

    // If Cloudinary provided size and it's large, use a streaming parser
    const declaredSize = cloudinaryResult.size || null;
    const MAX_BUFFER_CSV = 20 * 1024 * 1024; // 20MB - if larger, stream
    const shouldStream = declaredSize ? (declaredSize > MAX_BUFFER_CSV) : true;

    let rowCount = 0;
    let columns = [];
    const samples = [];
    let columnCount = 0;
    const sensitivePatterns = ['email', 'phone', 'ssn', 'password', 'salary', 'credit'];
    let potentiallySensitive = false;

    // Start by getting a stream
    const stream = await fetchStream(cloudinaryResult.secureUrl, 100 * 1024 * 1024); // 100MB ceiling for streaming

    await new Promise((resolve, reject) => {
      const parser = csvParser();

      let lastProgressUpdate = 0;

      parser.on('headers', (headers) => {
        columns = headers;
        columnCount = headers.length;
        potentiallySensitive = headers.some(header =>
          sensitivePatterns.some(pattern => header.toLowerCase().includes(pattern))
        );
      });

      parser.on('data', (row) => {
        rowCount += 1;
        if (samples.length < 3) {
          const sample = {};
          // copy only non-sensitive columns values (blank out if sensitive)
          for (const col of columns) {
            const lc = col.toLowerCase();
            const isSensitive = sensitivePatterns.some(p => lc.includes(p));
            sample[col] = isSensitive ? '[REDACTED]' : row[col];
          }
          samples.push(sample);
        }

        // update progress occasionally
        if (rowCount - lastProgressUpdate >= STREAM_CSV_ROW_PROGRESS_INTERVAL) {
          lastProgressUpdate = rowCount;
          if (cloudinaryResult.publicId) {
            processingTracker.updateProgress(cloudinaryResult.publicId, Math.min(99, Math.floor((rowCount / (declaredSize || 1)) * 100)));
          }
        }
      });

      parser.on('end', () => resolve());
      parser.on('error', (err) => reject(err));

      // pipeline stream -> parser
      streamPipeline(stream, parser).catch(reject);
    });

    return {
      ...baseResult,
      rowCount,
      columnCount,
      columns: columns.slice(0, columnCount),
      hasSensitiveData: potentiallySensitive,
      sampleRowCount: samples.length,
      sampleRows: samples,
      resourceType: cloudinaryResult.resourceType || 'raw',
      note: 'CSV analysis from Cloudinary stored file'
    };
  } catch (error) {
    throw new Error(`CSV processing failed: ${error.message}`);
  }
}

/**
 * ProcessingTracker (improved)
 */
class ProcessingTracker {
  constructor() {
    this.jobs = new Map();
  }

  startJob(fileId, operation) {
    this.jobs.set(fileId, {
      fileId,
      operation,
      status: 'processing',
      startTime: Date.now(),
      progress: 0
    });
  }

  updateProgress(fileId, progress) {
    const job = this.jobs.get(fileId);
    if (job) {
      job.progress = progress;
      job.lastUpdate = Date.now();
    }
  }

  completeJob(fileId, result) {
    const job = this.jobs.get(fileId);
    if (job) {
      job.status = 'completed';
      job.endTime = Date.now();
      job.duration = job.endTime - job.startTime;
      job.result = result;
      job.progress = 100;
    }
  }

  failJob(fileId, error) {
    const job = this.jobs.get(fileId);
    if (job) {
      job.status = 'failed';
      job.endTime = Date.now();
      job.duration = job.endTime - job.startTime;
      job.error = error.message || String(error);
      job.progress = job.progress || 0;
    }
  }

  getJob(fileId) {
    return this.jobs.get(fileId);
  }

  getAllJobs() {
    return Array.from(this.jobs.values());
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

const processingTracker = new ProcessingTracker();

// periodic cleanup
setInterval(() => {
  processingTracker.cleanupOldJobs();
}, 60 * 60 * 1000); // every hour

module.exports = {
  processFile,
  processImage,
  processPDF,
  processCSV,
  ProcessingTracker,
  processingTracker
};
