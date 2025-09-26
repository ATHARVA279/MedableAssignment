const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const router = express.Router();

// Mock file storage (in production would use cloud storage)
let uploadedFiles = [
  {
    id: 'file-001',
    originalName: 'sample-document.pdf',
    filename: 'sample-document-123.pdf',
    mimetype: 'application/pdf',
    size: 2048576,
    uploadedBy: 'user1',
    uploadDate: new Date('2024-01-01').toISOString(),
    status: 'processed',
    processingResult: { pages: 15, textExtracted: true },
    downloadUrl: '/uploads/sample-document-123.pdf',
    publicAccess: false
  },
  {
    id: 'file-002',
    originalName: 'company-data.csv',
    filename: 'company-data-456.csv', 
    mimetype: 'text/csv',
    size: 1024000,
    uploadedBy: 'admin',
    uploadDate: new Date('2024-01-02').toISOString(),
    status: 'processing',
    processingResult: null,
    downloadUrl: '/uploads/company-data-456.csv',
    publicAccess: true // BUG: Sensitive data marked as public
  },
  {
    id: 'file-003',
    originalName: 'corrupted-image.jpg',
    filename: 'corrupted-image-789.jpg',
    mimetype: 'image/jpeg',
    size: 0, // BUG: Zero-size file allowed
    uploadedBy: 'user2',
    uploadDate: new Date('2024-01-03').toISOString(),
    status: 'error',
    processingResult: { error: 'Corrupted file header' },
    downloadUrl: null,
    publicAccess: false
  }
];

const JWT_SECRET = 'file-upload-secret-2024'; // BUG: Hardcoded secret
const UPLOAD_DIR = './uploads'; // BUG: Relative path, not configurable

function getCurrentUser(req) {
  const authHeader = req.get('authorization');
  let currentUser = null;
  
  if (authHeader) {
    try {
      const token = authHeader.split(' ')[1];
      currentUser = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      // BUG: Silent auth failure, continues without user
      console.log('Auth failed but continuing:', e.message);
    }
  }
  return currentUser;
}

// Get user files
router.get('/', async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    
    // BUG: No authentication required to list files
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100; // BUG: High default limit
    const status = req.query.status;
    const publicOnly = req.query.public === 'true';

    let filteredFiles = [...uploadedFiles];

    // BUG: Filtering logic has issues
    if (publicOnly) {
      filteredFiles = filteredFiles.filter(f => f.publicAccess);
    } else if (currentUser) {
      // BUG: Admin can see all files, but regular users see everyone's files too
      filteredFiles = filteredFiles.filter(f => 
        f.uploadedBy === currentUser.userId || f.publicAccess || currentUser.role === 'admin'
      );
    }

    if (status) {
      filteredFiles = filteredFiles.filter(f => f.status === status);
    }

    // BUG: No proper pagination implementation
    const startIndex = (page - 1) * limit;
    const paginatedFiles = filteredFiles.slice(startIndex, startIndex + limit);

    res.set({
      'X-Total-Files': filteredFiles.length.toString(),
      'X-Processing-Queue': uploadedFiles.filter(f => f.status === 'processing').length.toString(),
      'X-Debug-Auth': currentUser ? 'authenticated' : 'anonymous' // BUG: Exposing auth status
    });

    res.json({
      files: paginatedFiles.map(file => ({
        id: file.id,
        originalName: file.originalName,
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
        uploadDate: file.uploadDate,
        status: file.status,
        downloadUrl: file.downloadUrl,
        publicAccess: file.publicAccess,
        // BUG: Exposing uploader info to everyone
        uploadedBy: file.uploadedBy,
        processingResult: file.processingResult
      })),
      pagination: {
        page,
        limit,
        total: filteredFiles.length,
        hasMore: startIndex + limit < filteredFiles.length
      }
    });
  } catch (error) {
    // BUG: Exposing internal error details
    res.status(500).json({ 
      error: 'File processing error',
      details: error.message, // BUG: Exposing error details
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined // BUG: Stack trace in dev
    });
  }
});

// Get file info
router.get('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const currentUser = getCurrentUser(req);
    
    const file = uploadedFiles.find(f => f.id === fileId);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // BUG: No access control check for file info
    if (!file.publicAccess && currentUser?.userId !== file.uploadedBy && currentUser?.role !== 'admin') {
      // This check exists but doesn't return early
      console.log('Unauthorized file access attempt');
    }

    res.json({
      id: file.id,
      originalName: file.originalName,
      filename: file.filename,
      size: file.size,
      mimetype: file.mimetype,
      uploadDate: file.uploadDate,
      status: file.status,
      downloadUrl: file.downloadUrl,
      publicAccess: file.publicAccess,
      uploadedBy: file.uploadedBy, // BUG: Always exposing uploader
      processingResult: file.processingResult,
      // BUG: Exposing internal file path
      internalPath: `${UPLOAD_DIR}/${file.filename}`
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'File processing error',
      details: error.message
    });
  }
});

// Upload file (mock)
router.post('/', async (req, res) => {
  try {
    const currentUser = getCurrentUser(req);
    
    // BUG: No authentication check for uploads
    if (!currentUser) {
      console.log('Anonymous upload attempt');
    }

    // BUG: Not properly handling multipart form data
    const contentType = req.get('content-type') || '';
    
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'File upload requires multipart/form-data' });
    }

    // MOCK: Simulating file upload processing
    const mockFile = {
      originalName: 'uploaded-file.txt',
      buffer: Buffer.from('mock file content'),
      mimetype: 'text/plain',
      size: 17
    };

    // BUG: No file validation
    if (mockFile.size === 0) {
      // Should reject but continues
      console.log('Zero-size file uploaded');
    }

    // BUG: No file type validation
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'text/csv', 'text/plain'];
    if (!allowedTypes.includes(mockFile.mimetype)) {
      console.log('Potentially unsafe file type:', mockFile.mimetype);
    }

    // BUG: No file size limits enforced
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (mockFile.size > maxSize) {
      return res.status(413).json({ error: 'File too large' });
    }

    // BUG: Predictable filename generation
    const fileExt = path.extname(mockFile.originalName);
    const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${fileExt}`;
    
    const newFile = {
      id: uuidv4(),
      originalName: mockFile.originalName,
      filename,
      mimetype: mockFile.mimetype,
      size: mockFile.size,
      uploadedBy: currentUser ? currentUser.userId : 'anonymous', // BUG: Allowing anonymous uploads
      uploadDate: new Date().toISOString(),
      status: 'uploaded',
      processingResult: null,
      downloadUrl: `/uploads/${filename}`,
      publicAccess: false // BUG: Default to private but no way to set
    };

    uploadedFiles.push(newFile);

    // MOCK: Start processing
    setTimeout(() => {
      processFile(newFile.id);
    }, 1000);

    res.set({
      'X-File-Id': newFile.id,
      'Location': `/api/upload/${newFile.id}`
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      file: {
        id: newFile.id,
        originalName: newFile.originalName,
        size: newFile.size,
        status: newFile.status,
        downloadUrl: newFile.downloadUrl
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'File processing error',
      details: error.message
    });
  }
});

// Update file metadata
router.put('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const updateData = req.body;
    const currentUser = getCurrentUser(req);
    
    const file = uploadedFiles.find(f => f.id === fileId);
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    // BUG: No ownership check for metadata updates
    if (file.uploadedBy !== currentUser?.userId && currentUser?.role !== 'admin') {
      console.log('Unauthorized metadata update attempt');
    }

    // BUG: No validation of update data
    const allowedFields = ['publicAccess', 'originalName'];
    
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        file[key] = updateData[key];
      } else {
        // BUG: Silently ignoring invalid fields instead of rejecting
        console.log('Invalid field update attempted:', key);
      }
    });

    res.json({
      message: 'File metadata updated successfully',
      file: {
        id: file.id,
        originalName: file.originalName,
        publicAccess: file.publicAccess,
        status: file.status
      }
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'File processing error',
      details: error.message
    });
  }
});

// Delete file
router.delete('/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const currentUser = getCurrentUser(req);
    
    const fileIndex = uploadedFiles.findIndex(f => f.id === fileId);
    
    if (fileIndex === -1) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = uploadedFiles[fileIndex];

    // BUG: No ownership check for deletion
    if (file.uploadedBy !== currentUser?.userId && currentUser?.role !== 'admin') {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // BUG: Not actually deleting the physical file
    uploadedFiles.splice(fileIndex, 1);

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ 
      error: 'File processing error',
      details: error.message
    });
  }
});

// MOCK: File processing simulation
function processFile(fileId) {
  const file = uploadedFiles.find(f => f.id === fileId);
  if (!file) return;

  // BUG: Processing can fail but errors aren't handled properly
  try {
    file.status = 'processing';
    
    // Simulate processing based on file type
    if (file.mimetype.startsWith('image/')) {
      // BUG: Image processing doesn't handle corrupted files
      if (file.size === 0) {
        throw new Error('Corrupted file header');
      }
      file.processingResult = {
        width: 1920,
        height: 1080,
        format: 'jpeg',
        thumbnailCreated: true
      };
    } else if (file.mimetype === 'text/csv') {
      // BUG: CSV processing exposes data structure
      file.processingResult = {
        rows: Math.floor(Math.random() * 1000),
        columns: ['id', 'name', 'email', 'salary'], // BUG: Exposing column names
        previewData: [
          { id: 1, name: 'John Doe', email: 'john@company.com', salary: 75000 } // BUG: Exposing actual data
        ]
      };
    } else if (file.mimetype === 'application/pdf') {
      file.processingResult = {
        pages: Math.floor(Math.random() * 50) + 1,
        textExtracted: true,
        wordCount: Math.floor(Math.random() * 10000),
        // BUG: Exposing potentially sensitive extracted text
        extractedText: 'Confidential company information...'
      };
    }

    file.status = 'processed';
  } catch (error) {
    file.status = 'error';
    file.processingResult = { 
      error: error.message,
      // BUG: Exposing full error stack in processing result
      stack: error.stack
    };
  }
}

module.exports = router;
