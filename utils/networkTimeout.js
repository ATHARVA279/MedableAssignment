const { logger } = require('./logger');
const { EventEmitter } = require('events');

class NetworkTimeoutHandler extends EventEmitter {
  constructor() {
    super();
    this.activeUploads = new Map();
    this.uploadChunks = new Map();
    this.timeoutSettings = {
      connectionTimeout: 30000, 
      uploadTimeout: 300000,  
      chunkTimeout: 60000,     
      maxRetries: 3,
      retryDelay: 2000        
    };
  }

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

  calculateOptimalChunkSize(fileSize) {
    if (fileSize < 1024 * 1024) {       
      return 256 * 1024;                 
    } else if (fileSize < 10 * 1024 * 1024) { 
      return 512 * 1024;                 
    } else if (fileSize < 100 * 1024 * 1024) { 
      return 1024 * 1024;               
    } else {
      return 2 * 1024 * 1024;            
    }
  }

  async uploadChunkWithTimeout(sessionId, chunkIndex, chunkData, uploadFunction) {
    const session = this.activeUploads.get(sessionId);
    if (!session) {
      throw new Error(`Upload session not found: ${sessionId}`);
    }

    const chunkId = `${sessionId}_chunk_${chunkIndex}`;
    let retryCount = 0;

    while (retryCount <= this.timeoutSettings.maxRetries) {
      try {
        session.lastActivity = Date.now();
        session.status = 'uploading';

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Chunk upload timeout after ${this.timeoutSettings.chunkTimeout}ms`));
          }, this.timeoutSettings.chunkTimeout);
        });

        const uploadPromise = uploadFunction(chunkData, chunkIndex, session);
        const result = await Promise.race([uploadPromise, timeoutPromise]);

        this.uploadChunks.get(sessionId).set(chunkIndex, {
          data: chunkData,
          uploadedAt: Date.now(),
          size: chunkData.length,
          checksum: this.calculateChecksum(chunkData)
        });

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
          const delay = this.timeoutSettings.retryDelay * Math.pow(2, retryCount - 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          
          this.emit('chunkRetry', {
            sessionId,
            chunkIndex,
            attempt: retryCount,
            delay
          });
        } else {
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

    const pendingChunks = [];
    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.uploadedChunks.has(i)) {
        pendingChunks.push(i);
      }
    }

    for (const chunkIndex of pendingChunks) {
      const chunkData = await this.getChunkData(sessionId, chunkIndex);
      if (chunkData) {
        await this.uploadChunkWithTimeout(sessionId, chunkIndex, chunkData, uploadFunction);
      }
    }

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

  async getChunkData(sessionId, chunkIndex) {
    const chunks = this.uploadChunks.get(sessionId);
    if (chunks && chunks.has(chunkIndex)) {
      return chunks.get(chunkIndex).data;
    }
    return null;
  }

  calculateChecksum(data) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(data).digest('hex');
  }

  async verifyUploadIntegrity(sessionId) {
    const session = this.activeUploads.get(sessionId);
    if (!session) {
      return false;
    }

    const chunks = this.uploadChunks.get(sessionId);
    if (!chunks) {
      return false;
    }

    for (let i = 0; i < session.totalChunks; i++) {
      if (!chunks.has(i)) {
        logger.warn('Missing chunk detected', { sessionId, chunkIndex: i });
        return false;
      }
    }

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

  async combineChunks(sessionId) {
    const session = this.activeUploads.get(sessionId);
    if (!session) {
      throw new Error(`Upload session not found: ${sessionId}`);
    }

    const chunks = this.uploadChunks.get(sessionId);
    if (!chunks) {
      throw new Error(`No chunks found for session: ${sessionId}`);
    }

    const isValid = await this.verifyUploadIntegrity(sessionId);
    if (!isValid) {
      throw new Error('Upload integrity check failed');
    }

    const combinedChunks = [];
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkInfo = chunks.get(i);
      if (!chunkInfo) {
        throw new Error(`Missing chunk ${i} for session ${sessionId}`);
      }
      combinedChunks.push(chunkInfo.data);
    }

    const combinedBuffer = Buffer.concat(combinedChunks);

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

  getActiveSessions(userId = null) {
    const sessions = [];
    
    for (const [sessionId, session] of this.activeUploads.entries()) {
      if (!userId || session.userId === userId) {
        sessions.push(this.getUploadProgress(sessionId));
      }
    }

    return sessions;
  }

  cancelUpload(sessionId) {
    const session = this.activeUploads.get(sessionId);
    if (session) {
      session.status = 'cancelled';
      session.cancelledAt = Date.now();
      
      this.emit('uploadCancelled', { sessionId });
      
      logger.info('Upload session cancelled', { sessionId });
      
      setTimeout(() => {
        this.cleanupSession(sessionId);
      }, 5000);
    }
  }


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

  getTimeoutSettings() {
    return { ...this.timeoutSettings };
  }

  updateTimeoutSettings(newSettings) {
    this.timeoutSettings = { ...this.timeoutSettings, ...newSettings };
    logger.info('Timeout settings updated', this.timeoutSettings);
  }
}

const networkTimeoutHandler = new NetworkTimeoutHandler();

setInterval(() => {
  networkTimeoutHandler.cleanupStaleSessions();
}, 60 * 60 * 1000);

module.exports = {
  NetworkTimeoutHandler,
  networkTimeoutHandler
};