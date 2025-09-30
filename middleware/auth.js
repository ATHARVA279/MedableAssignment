const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {
  const authHeader = req.get('authorization');
  
  if (!authHeader) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Invalid authorization header format' });
  }

  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, next) {
  const authHeader = req.get('authorization');
  
  if (authHeader) {
    try {
      const token = authHeader.split(' ')[1];
      if (token) {
        const user = jwt.verify(token, JWT_SECRET);
        req.user = user;
      }
    } catch (error) {
      console.log('Optional auth failed:', error.message);
    }
  }
  
  next();
}

function generateTestToken(userId = 'test-user', role = 'user') {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '24h' });
}

module.exports = {
  authenticateToken,
  optionalAuth,
  generateTestToken,
  JWT_SECRET
};