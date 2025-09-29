const express = require('express');
const { generateTestToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { userId = 'test-user', role = 'user' } = req.body;
  
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

router.post('/test-token', asyncHandler(async (req, res) => {
  const { userId = 'test-user', role = 'user' } = req.body;
  
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