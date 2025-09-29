const validator = require('validator');
const { logger } = require('./logger');

class InputSanitizer {
  constructor() {
    this.patterns = {
      xss: [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /on\w+\s*=/gi,
        /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi,
        /<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi,
        /<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi,
        /<link\b[^<]*(?:(?!<\/link>)<[^<]*)*<\/link>/gi,
        /<meta\b[^<]*(?:(?!<\/meta>)<[^<]*)*<\/meta>/gi
      ],
      
      sqlInjection: [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi,
        /(\b(OR|AND)\s+\d+\s*=\s*\d+)/gi,
        /('|(\\')|(;)|(--)|(\s)|(\/\*)|(\*\/))/gi,
        /(\b(WAITFOR|DELAY)\b)/gi
      ],
      
      pathTraversal: [
        /\.\.\//g,
        /\.\.\\/g,
        /%2e%2e%2f/gi,
        /%2e%2e%5c/gi,
        /\.\.%2f/gi,
        /\.\.%5c/gi
      ],
      
      commandInjection: [
        /[;&|`$(){}[\]]/g,
        /\b(cat|ls|pwd|whoami|id|uname|ps|netstat|ifconfig|ping|wget|curl|nc|telnet|ssh|ftp)\b/gi
      ],
      
      ldapInjection: [
        /[()=*!&|]/g,
        /\x00/g
      ]
    };

    this.allowedTags = ['b', 'i', 'em', 'strong', 'u', 'br', 'p'];
    this.maxLengths = {
      fileName: 255,
      description: 1000,
      comment: 500,
      tag: 50,
      email: 254,
      url: 2048,
      general: 1000
    };
  }

  sanitizeFileUpload(data) {
    const sanitized = {};
    const errors = [];

    if (data.originalName) {
      sanitized.originalName = this.sanitizeFileName(data.originalName);
      if (!this.validateFileName(sanitized.originalName)) {
        errors.push('Invalid filename format');
      }
    }

    if (data.description) {
      sanitized.description = this.sanitizeText(data.description, this.maxLengths.description);
      if (!sanitized.description) {
        errors.push('Description contains invalid content');
      }
    }

    if (data.tags) {
      if (Array.isArray(data.tags)) {
        sanitized.tags = data.tags
          .map(tag => this.sanitizeText(tag, this.maxLengths.tag))
          .filter(tag => tag && tag.length > 0)
          .slice(0, 10); 
      } else {
        errors.push('Tags must be an array');
      }
    }

    if (data.publicAccess !== undefined) {
      if (typeof data.publicAccess === 'boolean') {
        sanitized.publicAccess = data.publicAccess;
      } else if (typeof data.publicAccess === 'string') {
        sanitized.publicAccess = data.publicAccess.toLowerCase() === 'true';
      } else {
        errors.push('publicAccess must be a boolean');
      }
    }

    if (data.metadata && typeof data.metadata === 'object') {
      sanitized.metadata = this.sanitizeObject(data.metadata);
    }

    return {
      sanitized,
      errors,
      isValid: errors.length === 0
    };
  }

  sanitizeFileName(filename) {
    if (!filename || typeof filename !== 'string') {
      return '';
    }

    let sanitized = filename.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
    
    sanitized = sanitized.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
    
    sanitized = sanitized.replace(/[<>:"|?*]/g, '');
    
    if (sanitized.length > this.maxLengths.fileName) {
      const ext = sanitized.substring(sanitized.lastIndexOf('.'));
      const name = sanitized.substring(0, sanitized.lastIndexOf('.'));
      sanitized = name.substring(0, this.maxLengths.fileName - ext.length) + ext;
    }

    return sanitized.trim();
  }

  validateFileName(filename) {
    if (!filename || filename.length === 0) {
      return false;
    }

    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.') || filename.length).toUpperCase();
    
    if (reservedNames.includes(nameWithoutExt)) {
      return false;
    }

    const validPattern = /^[a-zA-Z0-9._\-\s()[\]{}]+$/;
    return validPattern.test(filename);
  }

  sanitizeText(text, maxLength = this.maxLengths.general) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let sanitized = text;
    this.patterns.xss.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    this.patterns.sqlInjection.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    this.patterns.commandInjection.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    this.patterns.pathTraversal.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    sanitized = sanitized.trim();
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
  }

  sanitizeHTML(html) {
    if (!html || typeof html !== 'string') {
      return '';
    }

    let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    
    sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/\s*javascript\s*:/gi, '');
    
    sanitized = sanitized.replace(/\s*style\s*=\s*["'][^"']*["']/gi, '');
    
    const allowedTagsPattern = new RegExp(`<(?!\/?(?:${this.allowedTags.join('|')})\s*\/?>)[^>]+>`, 'gi');
    sanitized = sanitized.replace(allowedTagsPattern, '');

    return sanitized.trim();
  }

  sanitizeEmail(email) {
    if (!email || typeof email !== 'string') {
      return '';
    }

    const sanitized = email.toLowerCase().trim();
    
    if (sanitized.length > this.maxLengths.email) {
      return '';
    }

    return validator.isEmail(sanitized) ? sanitized : '';
  }

  sanitizeURL(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }

    let sanitized = url.trim();
    
    if (sanitized.length > this.maxLengths.url) {
      return '';
    }

    if (!validator.isURL(sanitized, { 
      protocols: ['http', 'https'],
      require_protocol: true 
    })) {
      return '';
    }

    return sanitized;
  }

  sanitizeObject(obj, maxDepth = 3, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
      return {};
    }

    const sanitized = {};

    for (const [key, value] of Object.entries(obj)) {
      const sanitizedKey = this.sanitizeText(key, 50);
      if (!sanitizedKey) continue;

      if (typeof value === 'string') {
        sanitized[sanitizedKey] = this.sanitizeText(value);
      } else if (typeof value === 'number') {
        if (Number.isFinite(value)) {
          sanitized[sanitizedKey] = value;
        }
      } else if (typeof value === 'boolean') {
        sanitized[sanitizedKey] = value;
      } else if (Array.isArray(value)) {
        sanitized[sanitizedKey] = value
          .slice(0, 100) 
          .map(item => {
            if (typeof item === 'string') {
              return this.sanitizeText(item);
            } else if (typeof item === 'object' && item !== null) {
              return this.sanitizeObject(item, maxDepth, currentDepth + 1);
            }
            return item;
          })
          .filter(item => item !== null && item !== undefined);
      } else if (typeof value === 'object' && value !== null) {
        sanitized[sanitizedKey] = this.sanitizeObject(value, maxDepth, currentDepth + 1);
      }
    }

    return sanitized;
  }

  sanitizeQueryParams(query) {
    const sanitized = {};
    const errors = [];

    for (const [key, value] of Object.entries(query)) {
      const sanitizedKey = this.sanitizeText(key, 50);
      if (!sanitizedKey) {
        errors.push(`Invalid query parameter key: ${key}`);
        continue;
      }

      if (typeof value === 'string') {
        const sanitizedValue = this.sanitizeText(value, 200);
        if (sanitizedValue !== value) {
          logger.warn('Query parameter sanitized', { 
            key: sanitizedKey, 
            original: value, 
            sanitized: sanitizedValue 
          });
        }
        sanitized[sanitizedKey] = sanitizedValue;
      } else if (Array.isArray(value)) {
        sanitized[sanitizedKey] = value
          .slice(0, 10) 
          .map(v => this.sanitizeText(String(v), 200))
          .filter(v => v.length > 0);
      } else {
        sanitized[sanitizedKey] = this.sanitizeText(String(value), 200);
      }
    }

    return {
      sanitized,
      errors,
      isValid: errors.length === 0
    };
  }

  validateFileMetadata(metadata) {
    const errors = [];

    if (metadata.size !== undefined) {
      if (!Number.isInteger(metadata.size) || metadata.size < 0) {
        errors.push('File size must be a non-negative integer');
      }
    }

    if (metadata.mimetype) {
      const allowedMimeTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
        'text/csv', 'text/plain',
        'application/json',
        'application/zip'
      ];
      
      if (!allowedMimeTypes.includes(metadata.mimetype)) {
        errors.push(`Unsupported MIME type: ${metadata.mimetype}`);
      }
    }

    if (metadata.originalName) {
      if (!this.validateFileName(metadata.originalName)) {
        errors.push('Invalid filename');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  sanitizeSearchQuery(query) {
    if (!query || typeof query !== 'string') {
      return '';
    }

    let sanitized = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    this.patterns.sqlInjection.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '');
    });

    sanitized = sanitized.trim().substring(0, 100);

    return sanitized;
  }

  sanitizeRateLimitKey(key) {
    if (!key || typeof key !== 'string') {
      return 'unknown';
    }

    return key.replace(/[^a-zA-Z0-9._-]/g, '').substring(0, 50) || 'sanitized';
  }

  logSanitization(type, original, sanitized, context = {}) {
    if (original !== sanitized) {
      logger.warn('Input sanitized', {
        type,
        originalLength: original?.length || 0,
        sanitizedLength: sanitized?.length || 0,
        context,
        timestamp: new Date().toISOString()
      });
    }
  }

  sanitizeBatch(inputs) {
    const results = {};
    const errors = [];

    for (const [key, value] of Object.entries(inputs)) {
      try {
        if (key === 'email') {
          results[key] = this.sanitizeEmail(value);
        } else if (key === 'url') {
          results[key] = this.sanitizeURL(value);
        } else if (key === 'filename') {
          results[key] = this.sanitizeFileName(value);
        } else if (key === 'html') {
          results[key] = this.sanitizeHTML(value);
        } else if (typeof value === 'object') {
          results[key] = this.sanitizeObject(value);
        } else {
          results[key] = this.sanitizeText(String(value));
        }
      } catch (error) {
        errors.push(`Failed to sanitize ${key}: ${error.message}`);
        results[key] = '';
      }
    }

    return {
      sanitized: results,
      errors,
      isValid: errors.length === 0
    };
  }

  getStats() {
    return {
      patterns: Object.keys(this.patterns).reduce((acc, key) => {
        acc[key] = this.patterns[key].length;
        return acc;
      }, {}),
      maxLengths: this.maxLengths,
      allowedTags: this.allowedTags,
      timestamp: new Date().toISOString()
    };
  }
}

const inputSanitizer = new InputSanitizer();

module.exports = {
  InputSanitizer,
  inputSanitizer
};