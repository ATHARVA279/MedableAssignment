const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes
const uploadRoutes = require('./routes/upload');
const processingLogsRoutes = require('./routes/processing-logs');
const archiveRoutes = require('./routes/archive');

const app = express();
const PORT = process.env.PORT || 3004;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Custom headers for puzzle hints
app.use((req, res, next) => {
  res.set({
    'X-Upload-Limit': '10MB',
    'X-Hidden-Metadata': 'check_file_processing_logs_endpoint',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  next();
});

// Routes
app.use('/api/upload', uploadRoutes);
app.use('/api/processing-logs', processingLogsRoutes);
app.use('/api/archive', archiveRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`📁 Assessment 4: File Processing API running on http://localhost:${PORT}`);
  console.log(`📋 View instructions: http://localhost:${PORT}`);
  console.log(`🧩 Multi-layered puzzles and file security challenges await!`);
});
