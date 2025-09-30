const express = require('express');
const { generateTestToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { authenticateToken } = require('../middleware/auth');

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

router.get('/me', authenticateToken, (req, res) => {
  res.json({
    user: req.user,
    tokenValid: true
  });
});

module.exports = router;