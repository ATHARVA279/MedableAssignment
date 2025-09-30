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

function isEncryptionEnabled() {
  return config.security.encryptionKey && 
         config.security.encryptionKey !== 'default-encryption-key';
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

module.exports = {
  encryptFileBuffer,
  decryptFileBuffer,
  encryptFileForStorage,
  generateFileKey,
  isEncryptionEnabled,
  validateEncryptionMeta,
  createFileHash
};