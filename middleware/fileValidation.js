const path = require('path');
const crypto = require('crypto');

// Allowed MIME types
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png', 
  'application/pdf',
  'text/csv'
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const FILE_SIGNATURES = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47],
  'application/pdf': [0x25, 0x50, 0x44, 0x46], 
  'text/csv': null
};

function validateMimeType(mimetype) {
  return ALLOWED_MIME_TYPES.includes(mimetype);
}

function validateFileSize(size) {
  if (size === 0) {
    throw new Error('Zero-byte files are not allowed');
  }
  
  if (size > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
  }
  
  return true;
}

function validateFileContent(buffer, expectedMimeType) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty file buffer');
  }

  const signature = FILE_SIGNATURES[expectedMimeType];
  
  if (!signature) {
    return true;
  }

  if (buffer.length < signature.length) {
    throw new Error('File too small to validate signature');
  }

  for (let i = 0; i < signature.length; i++) {
    if (buffer[i] !== signature[i]) {
      throw new Error('File content does not match declared MIME type');
    }
  }
  
  if (expectedMimeType.startsWith('image/')) {
    if (buffer.length < 100) {
      throw new Error('Image file appears to be corrupted (too small)');
    }
    
    if (expectedMimeType === 'image/jpeg') {
      const lastBytes = buffer.slice(-10);
      let hasEndMarker = false;
      for (let i = 0; i < lastBytes.length - 1; i++) {
        if (lastBytes[i] === 0xFF && lastBytes[i + 1] === 0xD9) {
          hasEndMarker = true;
          break;
        }
      }
      if (!hasEndMarker) {
        console.warn('JPEG file may be corrupted (no end marker found), but proceeding with upload');
      }
    }
  }
  
  return true;
}

function generateSecureFilename(originalName) {
  const ext = path.extname(originalName);
  const uuid = crypto.randomUUID();
  return `${uuid}${ext}`;
}

async function performVirusScan(buffer, filename) {
  const { virusScanner } = require('../utils/virusScanner');
  
  try {
    const result = await virusScanner.scanFile(buffer, filename);
    
    if (!result.clean) {
      const threatNames = result.threats.map(t => t.name).join(', ');
      throw new Error(`Virus detected: ${threatNames}`);
    }
    
    return result;
  } catch (error) {
    const { logger } = require('../utils/logger');
    logger.error('Virus scan failed', { filename, error: error.message });
    
    if (process.env.NODE_ENV === 'production') {
      throw new Error('File security scan failed - upload blocked');
    }
    
    return { clean: true, scanner: 'fallback', note: 'Scan failed, allowed in development' };
  }
}

async function validateFile(file) {
  try {
    if (!validateMimeType(file.mimetype)) {
      throw new Error(`File type ${file.mimetype} is not allowed`);
    }
    
    validateFileSize(file.size);
    
    if (file.buffer) {
      validateFileContent(file.buffer, file.mimetype);
      
      await performVirusScan(file.buffer, file.originalname);
    }
    
    return true;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  validateFile,
  validateMimeType,
  validateFileSize,
  validateFileContent,
  generateSecureFilename,
  performVirusScan,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE
};