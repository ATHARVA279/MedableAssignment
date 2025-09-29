const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { inputSanitizer } = require('../utils/inputSanitizer');
const { memoryMonitor } = require('../utils/memoryMonitor');
const { logger } = require('../utils/logger');

/**
 * Production-ready security middleware
 */

// Enhanced rate limiting with different tiers
const createRateLimiter = (windowMs, max, message, skipSuccessfulRequests = false) => {
  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator: (req) => {
      // Use sanitized IP for rate limiting
      return inputSanitizer.sanitizeRateLimitKey(req.ip || 'unknown');
    },
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent')
      });
      res.status(429).json({ error: message });
    }
  });
};

// Strict rate limiting for production
const strictApiLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  50,             // 50 requests per window
  'Too many API requests, please try again later'
);

const strictUploadLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  5,              // 5 uploads per hour
  'Upload limit exceeded, please try again later',
  true            // Don't count failed uploads
);

const strictAuthLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5,              // 5 auth attempts per window
  'Too many authentication attempts, please try again later'
);

// Enhanced helmet configuration for production
const productionHelmet = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

// Request sanitization middleware
const sanitizeRequest = (req, res, next) => {
  try {
    // Sanitize query parameters
    if (req.query && Object.keys(req.query).length > 0) {
      const queryResult = inputSanitizer.sanitizeQueryParams(req.query);
      if (!queryResult.isValid) {
        logger.warn('Malicious query parameters detected', {
          ip: req.ip,
          path: req.path,
          originalQuery: req.query,
          errors: queryResult.errors
        });
        return res.status(400).json({ 
          error: 'Invalid request parameters',
          details: queryResult.errors 
        });
      }
      req.query = queryResult.sanitized;
    }

    // Sanitize URL parameters
    if (req.params && Object.keys(req.params).length > 0) {
      for (const [key, value] of Object.entries(req.params)) {
        const sanitized = inputSanitizer.sanitizeText(value, 100);
        if (sanitized !== value) {
          logger.warn('URL parameter sanitized', {
            ip: req.ip,
            path: req.path,
            param: key,
            original: value,
            sanitized
          });
        }
        req.params[key] = sanitized;
      }
    }

    next();
  } catch (error) {
    logger.error('Request sanitization failed', {
      error: error.message,
      ip: req.ip,
      path: req.path
    });
    res.status(500).json({ error: 'Request processing failed' });
  }
};

// Memory protection middleware
const memoryProtection = (req, res, next) => {
  const memoryStats = memoryMonitor.checkMemoryUsage();
  
  // Block requests if memory usage is critical
  if (memoryStats.system.percentage > 95) {
    logger.error('Request blocked due to critical memory usage', {
      ip: req.ip,
      path: req.path,
      memoryUsage: memoryStats.system.percentage
    });
    
    return res.status(503).json({
      error: 'Service temporarily unavailable due to high system load',
      retryAfter: 60
    });
  }

  // Add memory usage headers for monitoring
  res.set({
    'X-Memory-Usage': memoryStats.system.percentage.toFixed(2) + '%',
    'X-Active-Uploads': memoryStats.uploads.active.toString()
  });

  next();
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logger.info('Request received', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: req.get('Content-Length'),
    timestamp: new Date().toISOString()
  });

  // Log response
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      responseSize: data ? data.length : 0,
      ip: req.ip
    });

    originalSend.call(this, data);
  };

  next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  // Remove server information
  res.removeHeader('X-Powered-By');
  
  // Add security headers
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  next();
};

// File upload security middleware
const uploadSecurity = (req, res, next) => {
  // Check if this is a file upload request
  if (req.method === 'POST' && req.path.includes('/upload')) {
    // Additional security checks for file uploads
    const contentType = req.get('Content-Type');
    
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return res.status(400).json({
        error: 'Invalid content type for file upload'
      });
    }

    // Check content length
    const contentLength = parseInt(req.get('Content-Length') || '0');
    const maxSize = 50 * 1024 * 1024; // 50MB
    
    if (contentLength > maxSize) {
      return res.status(413).json({
        error: `File too large. Maximum size: ${maxSize / (1024 * 1024)}MB`
      });
    }
  }

  next();
};

// IP whitelist middleware (for admin endpoints)
const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    if (allowedIPs.length === 0) {
      return next(); // No whitelist configured
    }

    const clientIP = req.ip;
    const isAllowed = allowedIPs.some(allowedIP => {
      if (allowedIP.includes('/')) {
        // CIDR notation support would go here
        return false;
      }
      return clientIP === allowedIP;
    });

    if (!isAllowed) {
      logger.warn('IP not in whitelist', {
        ip: clientIP,
        path: req.path,
        allowedIPs
      });
      
      return res.status(403).json({
        error: 'Access denied from this IP address'
      });
    }

    next();
  };
};

// Suspicious activity detection
const suspiciousActivityDetection = (req, res, next) => {
  const suspiciousPatterns = [
    /\.\.\//,           // Path traversal
    /<script/i,         // XSS attempts
    /union.*select/i,   // SQL injection
    /exec\(/i,          // Command injection
    /eval\(/i           // Code injection
  ];

  const checkString = `${req.path} ${JSON.stringify(req.query)} ${JSON.stringify(req.body)}`;
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(checkString)) {
      logger.error('Suspicious activity detected', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent'),
        pattern: pattern.toString(),
        timestamp: new Date().toISOString()
      });

      return res.status(400).json({
        error: 'Request blocked due to suspicious activity'
      });
    }
  }

  next();
};

module.exports = {
  strictApiLimiter,
  strictUploadLimiter,
  strictAuthLimiter,
  productionHelmet,
  sanitizeRequest,
  memoryProtection,
  requestLogger,
  securityHeaders,
  uploadSecurity,
  ipWhitelist,
  suspiciousActivityDetection
};