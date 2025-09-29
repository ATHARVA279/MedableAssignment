const crypto = require('crypto');
const config = require('../config');
const { logger } = require('./logger');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; 
const IV_LENGTH = 16;  
const TAG_LENGTH = 16; 

function getEncryptionKey() {
  const key = config.security.encryptionKey;
  if (!key || key === 'default-encryption-key') {
    throw new Error('Encryption key not properly configured');
  }
  
  return crypto.scryptSync(key, 'file-encryption-salt', KEY_LENGTH);
}

function encryptFileBuffer(buffer, metadata = {}) {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
    
    const encrypted = Buffer.concat([
      cipher.update(buffer),
      cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();
    
    const encryptedBuffer = Buffer.concat([iv, tag, encrypted]);
    
    logger.info('File buffer encrypted', {
      originalSize: buffer.length,
      encryptedSize: encryptedBuffer.length,
      algorithm: ALGORITHM
    });
    
    return {
      encryptedBuffer,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      algorithm: ALGORITHM,
      keyVersion: 1 
    };
  } catch (error) {
    logger.error('File encryption failed', {
      error: error.message,
      bufferSize: buffer.length
    });
    throw new Error(`File encryption failed: ${error.message}`);
  }
}

function decryptFileBuffer(encryptedBuffer, encryptionMeta) {
  try {
    const key = getEncryptionKey();
    
    const iv = encryptedBuffer.slice(0, IV_LENGTH);
    const tag = encryptedBuffer.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = encryptedBuffer.slice(IV_LENGTH + TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    if (encryptionMeta.metadata) {
      decipher.setAAD(Buffer.from(JSON.stringify(encryptionMeta.metadata)));
    }
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    logger.info('File buffer decrypted', {
      encryptedSize: encryptedBuffer.length,
      decryptedSize: decrypted.length
    });
    
    return decrypted;
  } catch (error) {
    logger.error('File decryption failed', {
      error: error.message,
      encryptedSize: encryptedBuffer.length
    });
    throw new Error(`File decryption failed: ${error.message}`);
  }
}

async function encryptFileForStorage(fileBuffer, originalName, mimetype, userId) {
  try {
    const metadata = {
      originalName,
      mimetype,
      userId,
      encryptedAt: new Date().toISOString()
    };
    
    const encryptionResult = encryptFileBuffer(fileBuffer, metadata);
    
    return {
      encryptedBuffer: encryptionResult.encryptedBuffer,
      encryptionMeta: {
        iv: encryptionResult.iv,
        tag: encryptionResult.tag,
        algorithm: encryptionResult.algorithm,
        keyVersion: encryptionResult.keyVersion,
        metadata,
        isEncrypted: true
      }
    };
  } catch (error) {
    logger.error('File storage encryption failed', {
      error: error.message,
      originalName,
      userId
    });
    throw error;
  }
}

async function decryptFileFromStorage(encryptedBuffer, encryptionMeta) {
  try {
    if (!encryptionMeta.isEncrypted) {
      return encryptedBuffer;
    }
    
    return decryptFileBuffer(encryptedBuffer, encryptionMeta);
  } catch (error) {
    logger.error('File storage decryption failed', {
      error: error.message,
      algorithm: encryptionMeta.algorithm
    });
    throw error;
  }
}

function generateFileKey() {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

function encryptFileWithKey(buffer, customKey, metadata = {}) {
  try {
    const key = Buffer.from(customKey, 'hex');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    if (Object.keys(metadata).length > 0) {
      cipher.setAAD(Buffer.from(JSON.stringify(metadata)));
    }
    
    const encrypted = Buffer.concat([
      cipher.update(buffer),
      cipher.final()
    ]);
    
    const tag = cipher.getAuthTag();
    const encryptedBuffer = Buffer.concat([iv, tag, encrypted]);
    
    return {
      encryptedBuffer,
      iv: iv.toString('hex'),
      tag: tag.toString('hex')
    };
  } catch (error) {
    logger.error('Custom key encryption failed', {
      error: error.message
    });
    throw error;
  }
}

function decryptFileWithKey(encryptedBuffer, customKey, iv, tag, metadata = {}) {
  try {
    const key = Buffer.from(customKey, 'hex');
    const ivBuffer = Buffer.from(iv, 'hex');
    const tagBuffer = Buffer.from(tag, 'hex');

    const encrypted = encryptedBuffer.slice(IV_LENGTH + TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBuffer);
    decipher.setAuthTag(tagBuffer);
    
    if (Object.keys(metadata).length > 0) {
      decipher.setAAD(Buffer.from(JSON.stringify(metadata)));
    }
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted;
  } catch (error) {
    logger.error('Custom key decryption failed', {
      error: error.message
    });
    throw error;
  }
}

function isEncryptionEnabled() {
  return config.security.encryptionKey && 
         config.security.encryptionKey !== 'default-encryption-key';
}

function getEncryptionStatus() {
  return {
    enabled: isEncryptionEnabled(),
    algorithm: ALGORITHM,
    keyLength: KEY_LENGTH * 8, 
    ivLength: IV_LENGTH * 8,  
    tagLength: TAG_LENGTH * 8  
  };
}

function rotateEncryptionKey(newKey) {
  if (!newKey || newKey.length < 32) {
    throw new Error('New encryption key must be at least 32 characters');
  }
  
  logger.info('Encryption key rotation requested', {
    newKeyLength: newKey.length
  });
  
  return {
    success: true,
    message: 'Key rotation would be performed in production',
    newKeyVersion: 2
  };
}

function validateEncryptionMeta(encryptionMeta) {
  if (!encryptionMeta) {
    return false;
  }
  
  const required = ['algorithm', 'keyVersion', 'isEncrypted'];
  return required.every(field => encryptionMeta.hasOwnProperty(field));
}

function createFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function verifyFileIntegrity(buffer, expectedHash) {
  const actualHash = createFileHash(buffer);
  return actualHash === expectedHash;
}

module.exports = {
  encryptFileBuffer,
  decryptFileBuffer,
  encryptFileForStorage,
  decryptFileFromStorage,
  generateFileKey,
  encryptFileWithKey,
  decryptFileWithKey,
  isEncryptionEnabled,
  getEncryptionStatus,
  rotateEncryptionKey,
  validateEncryptionMeta,
  createFileHash,
  verifyFileIntegrity
};