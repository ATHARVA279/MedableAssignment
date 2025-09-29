const { logger } = require('./logger');
const { EventEmitter } = require('events');

/**
 * Network Timeout and Upload Resumption Handler
 */
class NetworkTimeoutHandler extends EventEmitter {
  constructor() {
    super();
    this.activeUploads = new Map();
    this.uploadChunks = new Map();
    this.timeoutSettings = {
      connectionTimeout: 30000, // 30 seconds
      uploadTimeout: 300000,    // 5 minutes
      chunkTimeout: 60000,      // 1 minute per chunk
      maxRetries: 3,
      retryDelay: 2000         // 2 seconds
    };
  }

  /**
   * Create resumable upload session
   */
  createUploadSession(fileId, fileSize, fileName, userId) {
    const sessionId = `upload_${fileId}_${Date.now()}`;
    const chunkSize = this.calculateOptimalChunkSize(fileSize);
    const totalChunks = Math.ceil(fileSize / chunkSize);

    const session = {
      sessionId,
      fileId,
      fileName,
      userId,
      fileSize,
      chunkSize,
      totalChunks,
      uploadedChunks: new Set(),
      failedChunks: new Set(),
      startTime: Date.now(),
      lastActivity: Date.now(),
      status: 'initialized',
      retryCount: 0,
      metadata: {}
    };

    this.activeUploads.set(sessionId, session);
    this.uploadChunks.set(sessionId, new Map());

    logger.info('Upload session created', {
      sessionId,
      fileId,
      fileName,
      fileSize,
      chunkSize,
      totalChunks
    });

    return session;
  }

  /**
   * Calculate optimal chunk size based on file size
   */
  calculateOptimalChunkSize(fileSize) {
    // Adaptive chunk sizing
    if (fileSize < 1024 * 1024) {        // < 1MB
      return 256 * 1024;                  // 256KB chunks
    } else if (fileSize < 10 * 1024 * 1024) { // < 10MB
      return 512 * 1024;                  // 512KB chunks
    } else if (fileSize < 100 * 1024 * 1024) { // < 100MB
      return 1024 * 1024;                 // 1MB chunks
    } else {
      return 2 * 1024 * 1024;             // 2MB chunks for large files
    }
  }

  /**
   * Handle chunk upload with timeout protection
   */
  async uploadChunkWithTimeout(sessionId, chunkIndex, chunkData, uploadFunction) {
    const session = this.activeUploads.get(sessionId);
    if (!session) {
      throw new Error(`Upload session not found: ${sessionId}`);
    }

    const chunkId = `${sessionId}_chunk_${chunkIndex}`;
    let retryCount = 0;

    while (retryCount <= this.timeoutSettings.maxRetries) {
      try {
        // Update session activity
        session.lastActivity = Date.now();
        session.status = 'uploading';

        // Create timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Chunk upload timeout after ${this.timeoutSettings.chunkTimeout}ms`));
          }, this.timeoutSettings.chunkTimeout);
        });

        // Race between upload and timeout
        const uploadPromise = uploadFunction(chunkData, chunkIndex, session);
        const result = await Promise.race([uploadPromise, timeoutPromise]);

        // Store chunk data for potential retry
        this.uploadChunks.get(sessionId).set(chunkIndex, {
          data: chunkData,
          uploadedAt: Date.now(),
          size: chunkData.length,
          checksum: this.calculateChecksum(chunkData)
        });

        // Mark chunk as uploaded
        session.uploadedChunks.add(chunkIndex);
        session.failedChunks.delete(chunkIndex);

        logger.debug('Chunk uploaded successfully', {
          sessionId,
          chunkIndex,
          chunkSize: chunkData.length,
          progress: `${session.uploadedChunks.size}/${session.totalChunks}`
        });

        this.emit('chunkUploaded', {
          sessionId,
          chunkIndex,
          progress: session.uploadedChunks.size / session.totalChunks
        });

        return result;

      } catch (error) {
        retryCount++;
        session.failedChunks.add(chunkIndex);

        logger.warn('Chunk upload failed', {
          sessionId,
          chunkIndex,
          attempt: retryCount,
          maxRetries: this.timeoutSettings.maxRetries,
          error: error.message
        });

        if (retryCount <= this.timeoutSettings.maxRetries) {
          // Wait before retry with exponential backoff
          const delay = this.timeoutSettings.retryDelay * Math.pow(2, retryCount - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          this.emit('chunkRetry', {
            sessionId,
            chunkIndex,
            attempt: retryCount,
            delay
          });
        } else {
          // Max retries exceeded
          session.status = 'failed';
          this.emit('chunkFailed', {
            sessionId,
            chunkIndex,
            error: error.message
          });
          throw error;
        }
      }
    }
  }

  /**
   * Resume failed upload
   */
  async resumeUpload(sessionId, uploadFunction) {
    const session = this.activeUploads.get(sessionId);
    if (!session) {
      throw new Error(`Upload session not found: ${sessionId}`);
    }

    logger.info('Resuming upload', {
      sessionId,
      uploadedChunks: session.uploadedChunks.size,
      totalChunks: session.totalChunks,
      failedChunks: session.failedChunks.size
    });

    session.status = 'resuming';
    session.retryCount++;

    // Get chunks that need to be uploaded
    const pendingChunks = [];
    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.uploadedChunks.has(i)) {
        pendingChunks.push(i);
      }
    }

    // Upload pending chunks
    for (const chunkIndex of pendingChunks) {
      const chunkData = await this.getChunkData(sessionId, chunkIndex);
      if (chunkData) {
        await this.uploadChunkWithTimeout(sessionId, chunkIndex, chunkData, uploadFunction);
      }
    }

    // Check if upload is complete
    if (session.uploadedChunks.size === session.totalChunks) {
      session.status = 'completed';
      session.completedAt = Date.now();
      
      this.emit('uploadCompleted', {
        sessionId,
        duration: session.completedAt - session.startTime,
        totalChunks: session.totalChunks
      });

      logger.info('Upload resumed and completed', {
        sessionId,
        duration: session.completedAt - session.startTime,
        retryCount: session.retryCount
      });
    }

    return session;
  }

  /**
   * Get chunk data for resumption
   */
  async getChunkData(sessionId, chunkIndex) {
    const chunks = this.uploadChunks.get(sessionId);
    if (chunks && chunks.has(chunkIndex)) {
      return chunks.get(chunkIndex).data;
    }
    return null;
  }

  /**
   * Calculate chunk checksum for integrity verification
   */
  calculateChecksum(data) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * Verify upload integrity
   */
  async verifyUploadIntegrity(sessionId) {
    const session = this.activeUploads.get(sessionId);
    if (!session) {
      return false;
    }

    const chunks = this.uploadChunks.get(sessionId);
    if (!chunks) {
      return false;
    }

    // Verify all chunks are present
    for (let i = 0; i < session.totalChunks; i++) {
      if (!chunks.has(i)) {
        logger.warn('Missing chunk detected', { sessionId, chunkIndex: i });
        return false;
      }
    }

    // Verify chunk checksums
    for (const [chunkIndex, chunkInfo] of chunks.entries()) {
      const currentChecksum = this.calculateChecksum(chunkInfo.data);
      if (currentChecksum !== chunkInfo.checksum) {
        logger.warn('Chunk checksum mismatch', { 
          sessionId, 
          chunkIndex, 
          expected: chunkInfo.checksum, 
          actual: currentChecksum 
        });
        return false;
      }
    }

    logger.info('Upload integrity verified', { sessionId });
    return true;
  }

  /**
   * Combine uploaded chunks into final file
   */
  async combineChunks(sessionId) {
    const session = this.activeUploads.get(sessionId);
    if (!session) {
      throw new Error(`Upload session not found: ${sessionId}`);
    }

    const chunks = this.uploadChunks.get(sessionId);
    if (!chunks) {
      throw new Error(`No chunks found for session: ${sessionId}`);
    }

    // Verify integrity before combining
    const isValid = await this.verifyUploadIntegrity(sessionId);
    if (!isValid) {
      throw new Error('Upload integrity check failed');
    }

    // Combine chunks in order
    const combinedChunks = [];
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkInfo = chunks.get(i);
      if (!chunkInfo) {
        throw new Error(`Missing chunk ${i} for session ${sessionId}`);
      }
      combinedChunks.push(chunkInfo.data);
    }

    const combinedBuffer = Buffer.concat(combinedChunks);

    // Verify final file size
    if (combinedBuffer.length !== session.fileSize) {
      throw new Error(`File size mismatch: expected ${session.fileSize}, got ${combinedBuffer.length}`);
    }

    logger.info('Chunks combined successfully', {
      sessionId,
      finalSize: combinedBuffer.length,
      chunkCount: session.totalChunks
    });

    return combinedBuffer;
  }

  /**
   * Clean up upload session
   */
  cleanupSession(sessionId) {
    const session = this.activeUploads.get(sessionId);
    if (session) {
      this.activeUploads.delete(sessionId);
      this.uploadChunks.delete(sessionId);
      
      logger.info('Upload session cleaned up', {
        sessionId,
        duration: Date.now() - session.startTime,
        status: session.status
      });
    }
  }

  /**
   * Get upload progress
   */
  getUploadProgress(sessionId) {
    const session = this.activeUploads.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId,
      fileId: session.fileId,
      fileName: session.fileName,
      progress: session.uploadedChunks.size / session.totalChunks,
      uploadedChunks: session.uploadedChunks.size,
      totalChunks: session.totalChunks,
      failedChunks: session.failedChunks.size,
      status: session.status,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      retryCount: session.retryCount
    };
  }

  /**
   * List active upload sessions
   */
  getActiveSessions(userId = null) {
    const sessions = [];
    
    for (const [sessionId, session] of this.activeUploads.entries()) {
      if (!userId || session.userId === userId) {
        sessions.push(this.getUploadProgress(sessionId));
      }
    }

    return sessions;
  }

  /**
   * Cancel upload session
   */
  cancelUpload(sessionId) {
    const session = this.activeUploads.get(sessionId);
    if (session) {
      session.status = 'cancelled';
      session.cancelledAt = Date.now();
      
      this.emit('uploadCancelled', { sessionId });
      
      logger.info('Upload session cancelled', { sessionId });
      
      // Clean up after a delay to allow for any pending operations
      setTimeout(() => {
        this.cleanupSession(sessionId);
      }, 5000);
    }
  }

  /**
   * Clean up stale sessions
   */
  cleanupStaleSessions() {
    const now = Date.now();
    const staleTimeout = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [sessionId, session] of this.activeUploads.entries()) {
      if (now - session.lastActivity > staleTimeout) {
        logger.info('Cleaning up stale upload session', {
          sessionId,
          lastActivity: new Date(session.lastActivity).toISOString(),
          status: session.status
        });
        
        this.cleanupSession(sessionId);
      }
    }
  }

  /**
   * Get timeout settings
   */
  getTimeoutSettings() {
    return { ...this.timeoutSettings };
  }

  /**
   * Update timeout settings
   */
  updateTimeoutSettings(newSettings) {
    this.timeoutSettings = { ...this.timeoutSettings, ...newSettings };
    logger.info('Timeout settings updated', this.timeoutSettings);
  }
}

// Global network timeout handler instance
const networkTimeoutHandler = new NetworkTimeoutHandler();

// Clean up stale sessions every hour
setInterval(() => {
  networkTimeoutHandler.cleanupStaleSessions();
}, 60 * 60 * 1000);

module.exports = {
  NetworkTimeoutHandler,
  networkTimeoutHandler
};