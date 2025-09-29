const helmet = require("helmet");
const config = require("../config");

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
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
});

const sanitizeRequest = (req, res, next) => {
  for (const key in req.query) {
    if (typeof req.query[key] === "string") {
      req.query[key] = req.query[key].replace(/[<>\"']/g, "");
    }
  }

  if (!req.path.includes("/upload") && req.body) {
    const bodyStr = JSON.stringify(req.body);
    if (bodyStr.length > 10000) {
      return res.status(413).json({ error: "Request body too large" });
    }
  }

  next();
};

const ipWhitelist = (allowedIPs = []) => {
  return (req, res, next) => {
    if (config.server.isProduction && allowedIPs.length > 0) {
      const clientIP = req.ip || req.connection.remoteAddress;
      if (!allowedIPs.includes(clientIP)) {
        return res.status(403).json({ error: "Access denied from this IP" });
      }
    }
    next();
  };
};

const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      userId: req.user?.userId || "anonymous",
    };

    if (config.server.isDevelopment) {
      console.log(
        `${logData.method} ${logData.url} ${logData.status} ${logData.duration}`
      );
    } else {
      console.log(JSON.stringify(logData));
    }
  });

  next();
};

module.exports = {
  securityHeaders,
  sanitizeRequest,
  ipWhitelist,
  requestLogger,
};
