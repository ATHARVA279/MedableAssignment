const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

/**
 * File Schema for MongoDB
 * Stores metadata while Cloudinary handles actual file storage
 */
const fileSchema = new mongoose.Schema({
  // Unique file identifier
  fileId: {
    type: String,
    required: true,
    unique: true,
    default: () => `file-${uuidv4().substring(0, 8)}`
  },
  
  // Original file information
  originalName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  
  // Cloudinary information
  cloudinaryUrl: {
    type: String,
    required: true
  },
  
  cloudinaryPublicId: {
    type: String,
    required: true,
    unique: true
  },
  
  // File metadata
  size: {
    type: Number,
    required: true,
    min: 0
  },
  
  mimetype: {
    type: String,
    required: true,
    enum: ['image/jpeg', 'image/png', 'application/pdf', 'text/csv', 'image/gif', 'image/webp']
  },
  
  // User information
  uploaderId: {
    type: String,
    required: true,
    index: true
  },
  
  // Processing status
  status: {
    type: String,
    required: true,
    enum: ['uploaded', 'processing', 'processed', 'failed', 'deleted'],
    default: 'uploaded',
    index: true
  },
  
  // Access control
  publicAccess: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // Processing results (stored as flexible object)
  processingResult: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  
  // File tags and description
  tags: [{
    type: String,
    trim: true,
    maxlength: 50
  }],
  
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  
  // Encryption metadata
  encryptionMeta: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  
  // Version information
  version: {
    type: Number,
    default: 1,
    min: 1
  },
  
  parentFileId: {
    type: String,
    default: null
  },
  
  // Sharing information
  shareToken: {
    type: String,
    default: null
  },
  
  shareExpiry: {
    type: Date,
    default: null
  },
  
  sharePassword: {
    type: String,
    default: null
  },
  
  // Access tracking
  downloadCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  lastAccessed: {
    type: Date,
    default: null
  },
  
  // Virus scan results
  virusScanResult: {
    clean: {
      type: Boolean,
      default: null
    },
    scanner: {
      type: String,
      default: null
    },
    scanDate: {
      type: Date,
      default: null
    },
    threats: [{
      name: String,
      severity: String
    }]
  },
  
  // Backup information
  backupStatus: {
    type: String,
    enum: ['pending', 'backed_up', 'failed', 'not_required'],
    default: 'pending'
  },
  
  lastBackup: {
    type: Date,
    default: null
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Remove sensitive fields from JSON output
      delete ret._id;
      delete ret.__v;
      delete ret.sharePassword;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for better query performance
fileSchema.index({ uploaderId: 1, createdAt: -1 });
fileSchema.index({ status: 1, createdAt: -1 });
fileSchema.index({ publicAccess: 1, status: 1 });
fileSchema.index({ mimetype: 1, status: 1 });
fileSchema.index({ tags: 1 });
fileSchema.index({ shareToken: 1 }, { unique: true, sparse: true, partialFilterExpression: { shareToken: { $ne: null } } });
fileSchema.index({ parentFileId: 1 }, { sparse: true });

// Virtual for secure URL (uses cloudinaryUrl)
fileSchema.virtual('secureUrl').get(function() {
  return this.cloudinaryUrl;
});

// Virtual for file age
fileSchema.virtual('age').get(function() {
  return Date.now() - this.createdAt.getTime();
});

// Virtual for human readable size
fileSchema.virtual('humanSize').get(function() {
  const bytes = this.size;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
});

// Pre-save middleware
fileSchema.pre('save', function(next) {
  // Update lastAccessed if this is a download
  if (this.isModified('downloadCount')) {
    this.lastAccessed = new Date();
  }
  
  // Ensure fileId is set
  if (!this.fileId) {
    this.fileId = `file-${uuidv4().substring(0, 8)}`;
  }
  
  next();
});

// Static methods
fileSchema.statics.findByUploader = function(uploaderId, options = {}) {
  const query = { uploaderId, status: { $ne: 'deleted' } };
  
  let mongoQuery = this.find(query);
  
  if (options.status) {
    mongoQuery = mongoQuery.where('status', options.status);
  }
  
  if (options.mimetype) {
    mongoQuery = mongoQuery.where('mimetype', options.mimetype);
  }
  
  if (options.publicAccess !== undefined) {
    mongoQuery = mongoQuery.where('publicAccess', options.publicAccess);
  }
  
  if (options.limit) {
    mongoQuery = mongoQuery.limit(options.limit);
  }
  
  if (options.skip) {
    mongoQuery = mongoQuery.skip(options.skip);
  }
  
  return mongoQuery.sort({ createdAt: -1 });
};

fileSchema.statics.findPublicFiles = function(options = {}) {
  const query = { publicAccess: true, status: 'processed' };
  
  let mongoQuery = this.find(query);
  
  if (options.mimetype) {
    mongoQuery = mongoQuery.where('mimetype', options.mimetype);
  }
  
  if (options.limit) {
    mongoQuery = mongoQuery.limit(options.limit);
  }
  
  if (options.skip) {
    mongoQuery = mongoQuery.skip(options.skip);
  }
  
  return mongoQuery.sort({ createdAt: -1 });
};

fileSchema.statics.searchFiles = function(searchTerm, uploaderId = null, options = {}) {
  const searchRegex = new RegExp(searchTerm, 'i');
  
  let query = {
    status: { $ne: 'deleted' },
    $or: [
      { originalName: searchRegex },
      { description: searchRegex },
      { tags: { $in: [searchRegex] } }
    ]
  };
  
  if (uploaderId) {
    query.uploaderId = uploaderId;
  } else {
    query.publicAccess = true;
  }
  
  let mongoQuery = this.find(query);
  
  if (options.limit) {
    mongoQuery = mongoQuery.limit(options.limit);
  }
  
  if (options.skip) {
    mongoQuery = mongoQuery.skip(options.skip);
  }
  
  return mongoQuery.sort({ createdAt: -1 });
};

// Instance methods
fileSchema.methods.incrementDownload = function() {
  this.downloadCount += 1;
  this.lastAccessed = new Date();
  return this.save();
};

fileSchema.methods.updateProcessingStatus = function(status, result = null) {
  this.status = status;
  if (result) {
    this.processingResult = result;
  }
  return this.save();
};

fileSchema.methods.softDelete = function() {
  this.status = 'deleted';
  return this.save();
};

fileSchema.methods.createShareToken = function(expiryHours = 24, password = null) {
  this.shareToken = uuidv4();
  this.shareExpiry = new Date(Date.now() + (expiryHours * 60 * 60 * 1000));
  if (password) {
    const crypto = require('crypto');
    this.sharePassword = crypto.createHash('sha256').update(password).digest('hex');
  }
  return this.save();
};

fileSchema.methods.isShareValid = function() {
  if (!this.shareToken) return false;
  if (this.shareExpiry && this.shareExpiry < new Date()) return false;
  return true;
};

// Create and export the model
const File = mongoose.model('File', fileSchema);

module.exports = File;