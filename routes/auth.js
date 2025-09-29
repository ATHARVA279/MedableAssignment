const express = require('express');
const { generateTestToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

// Simple login endpoint (for development/testing)
router.post('/login', asyncHandler(async (req, res) => {
  const { userId = 'test-user', role = 'user' } = req.body;
  
  // Validate role
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be either "user" or "admin"' });
  }
  
  const token = generateTestToken(userId, role);
  
  res.json({
    message: 'Login successful',
    token,
    user: { userId, role },
    expiresIn: '24h'
  });
}));

// Generate test tokens for development/testing
router.post('/test-token', asyncHandler(async (req, res) => {
  const { userId = 'test-user', role = 'user' } = req.body;
  
  // Validate role
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be either "user" or "admin"' });
  }
  
  const token = generateTestToken(userId, role);
  
  res.json({
    message: 'Test token generated successfully',
    token,
    user: { userId, role },
    usage: `Authorization: Bearer ${token}`,
    expiresIn: '24h'
  });
}));

// Get current user info (requires valid token)
router.get('/me', (req, res) => {
  const authHeader = req.get('authorization');
  
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header provided' });
  }
  
  try {
    const jwt = require('jsonwebtoken');
    const { JWT_SECRET } = require('../middleware/auth');
    
    const token = authHeader.split(' ')[1];
    const user = jwt.verify(token, JWT_SECRET);
    
    res.json({
      user,
      tokenValid: true
    });
  } catch (error) {
    res.status(403).json({ 
      error: 'Invalid token',
      tokenValid: false 
    });
  }
});

module.exports = router;