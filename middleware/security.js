const helmet = require('helmet');
const config = require('../config');

// Security headers middleware
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for file uploads
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// Request sanitization middleware
const sanitizeRequest = (req, res, next) => {
  // Remove potentially dangerous characters from query params
  for (const key in req.query) {
    if (typeof req.query[key] === 'string') {
      req.query[key] = req.query[key].replace(/[<>\"']/g, '');
    }
  }
  
  // Limit request body size for non-upload endpoints
  if (!req.path.includes('/upload') && req.body) {
    const bodyStr = JSON.stringify(req.body);
    if (bodyStr.length > 10000) { // 10KB limit for non-upload requests
      return res.status(413).json({ error: 'Request body too large' });
    }
  }
  
  next();
};

// IP whitelist middleware (for admin endpoints if needed)
const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    if (config.server.isProduction && allowedIPs.length > 0) {
      const clientIP = req.ip || req.connection.remoteAddress;
      if (!allowedIPs.includes(clientIP)) {
        return res.status(403).json({ error: 'Access denied from this IP' });
      }
    }
    next();
  };
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.userId || 'anonymous'
    };
    
    // Log to console in development, to file in production
    if (config.server.isDevelopment) {
      console.log(`${logData.method} ${logData.url} ${logData.status} ${logData.duration}`);
    } else {
      // In production, you'd write to a log file or logging service
      console.log(JSON.stringify(logData));
    }
  });
  
  next();
};

module.exports = {
  securityHeaders,
  sanitizeRequest,
  ipWhitelist,
  requestLogger
};