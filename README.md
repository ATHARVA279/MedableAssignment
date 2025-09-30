# � **File Upload/Processing API Assessment**

## 📋 **Project Overview**

This is a comprehensive **File Upload/Processing API** assessment that demonstrates enterprise-grade file handling, security implementations, and multi-layered puzzle challenges. The system provides secure file upload, processing, storage, and management capabilities with advanced features including virus scanning, file encryption, version control, and an interactive React frontend.

**Key Features:**
- ✅ Secure file upload with validation and virus scanning
- ✅ Advanced file processing (PDF, CSV, images)
- ✅ Multi-layered security puzzle chain
- ✅ JWT-based authentication with role-based access control
- ✅ Rate limiting and comprehensive error handling
- ✅ React frontend application with modern UI
- ✅ Archive system with encrypted downloads
- ✅ Real-time monitoring and logging
---

## 🛠 **Setup & Installation**

### **Prerequisites**
- Node.js 18.x or higher
- npm or yarn package manager
- MongoDB instance (local or cloud)
- Cloudinary account (optional for cloud storage)

### **Installation**

1. **Clone and install dependencies:**
```bash
cd MedableAssignment
npm install
```

2. **Frontend setup:**
```bash
cd file-processing-frontend
npm install
```

3. **Environment configuration:**
```bash
# Copy and configure environment variables
cp .env.example .env
```

4. **Start the server:**
```bash
# Development mode
npm run dev

# Production mode
npm start
```

5. **Start the frontend (separate terminal):**
```bash
cd file-processing-frontend
npm run dev
```

---

## 🔧 **Environment Variables**

Create a `.env` file in the root directory:

```env
# Server Configuration
NODE_ENV=development
PORT=8888
HOST=localhost

# Database
MONGO_URI=mongodb://localhost:27017/file_uploads
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your-secure-jwt-secret-here
ENCRYPTION_KEY=your-32-char-encryption-key
BCRYPT_ROUNDS=12

# Storage (Cloudinary)
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_UPLOAD_MAX=10

# File Processing
MAX_FILE_SIZE=10485760
ALLOWED_MIME_TYPES=image/jpeg,image/png,application/pdf,text/csv

# Puzzle System
PUZZLE_ADMIN_CODE=PROC_LOGS_ADMIN_2024
PUZZLE_SYSTEM_KEY=system-processing-key-2024
PUZZLE_ARCHIVE_KEY=ARCHIVE_MASTER_2024

# Virus Scanning
VIRUSTOTAL_API_KEY=your-virustotal-api-key
MOCK_VIRUS_SCAN=true

# Monitoring
LOG_LEVEL=info
METRICS_ENABLED=true
HEALTH_CHECK_INTERVAL=30000
```

---

## 📁 **File Structure Overview**

```
MedableAssignment/
├── server.js                           # Main application entry point
├── package.json                        # Project dependencies and scripts
├── config/
│   ├── index.js                        # Centralized configuration
│   └── db.js                          # Database connection
├── middleware/
│   ├── auth.js                         # JWT authentication
│   ├── errorHandler.js                 # Centralized error handling
│   ├── fileValidation.js               # File type & content validation
│   ├── productionSecurity.js           # Enhanced production security
│   ├── rateLimiter.js                  # API rate limiting
│   └── security.js                     # Security headers & sanitization
├── routes/
│   ├── auth.js                         # Authentication endpoints
│   ├── upload.js                       # File upload & management
│   ├── processing-logs.js              # Puzzle: Processing logs access
│   ├── archive.js                      # Puzzle: Archive downloads
│   ├── admin.js                        # Admin panel endpoints
│   ├── batch.js                        # Batch file processing
│   ├── sharing.js                      # File sharing system
│   ├── versions.js                     # File version control
│   ├── queue.js                        # Job queue management
│   └── virusScan.js                    # Virus scanning endpoints
├── utils/
│   ├── enhancedFileProcessor.js        # Advanced file processing
│   ├── fileStorage.js                  # Storage abstraction layer
│   ├── fileEncryption.js               # File encryption utilities
│   ├── fileVersioning.js               # Version control system
│   ├── fileCompression.js              # File compression utilities
│   ├── virusScanner.js                 # Multi-scanner virus detection
│   ├── logger.js                       # Structured logging
│   ├── monitoring.js                   # System health monitoring
│   ├── jobQueue.js                     # Background job processing
│   ├── retryManager.js                 # Retry logic for operations
│   ├── inputSanitizer.js               # Input validation & sanitization
│   ├── accessLogger.js                 # Access control logging
│   ├── networkTimeout.js               # Network timeout handling
│   └── backupRecovery.js               # Backup & recovery system
├── models/
│   └── File.js                         # File data model
├── services/
│   └── fileService.js                  # Business logic layer
├── logs/                               # Application logs
├── backups/                            # System backups
├── file-processing-frontend/            # React frontend application
│   ├── src/
│   │   ├── components/                 # Reusable UI components
│   │   ├── pages/                      # Application pages
│   │   ├── services/                   # API client services
│   │   └── contexts/                   # React context providers
│   └── package.json                   # Frontend dependencies
└── README.md                          # This documentation
```

---

## 🔐 **Authentication & Security**

### **Security Vulnerabilities Fixed**
The system addresses critical security vulnerabilities:

- ✅ **File Type Validation**: MIME type checking with magic byte verification
- ✅ **Size Limits**: 10MB file size limit with memory protection
- ✅ **Virus Scanning**: ClamAV integration with multiple scanner support
- ✅ **Authentication Required**: JWT tokens required for all file operations
- ✅ **Access Control**: User ownership verification and role-based permissions
- ✅ **Input Sanitization**: XSS protection and path traversal prevention
- ✅ **Secure Filenames**: UUID-based filename generation
- ✅ **Rate Limiting**: API rate limiting with IP-based tracking
- ✅ **Helmet Security**: Production-grade security headers

### **JWT Implementation**
```javascript
// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.get('authorization');
  const token = authHeader?.split(' ')[1];
  
  try {
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}
```

### **Role-Based Access Control**
- **User Role**: Basic file upload/download/management
- **Admin Role**: System monitoring, user management, advanced features
- **Puzzle Access**: Special endpoints require specific keys/codes

---

## 🚀 **Features Implemented**

### **File Upload & Storage**
- Secure file upload with validation
- Cloudinary cloud storage integration
- Local storage fallback option
- Automatic thumbnail generation for images
- File compression support
- Virus scanning integration

### **File Processing**
- **PDF Processing**: Text extraction, metadata reading
- **CSV Analysis**: Row counting, data preview, column analysis
- **Image Processing**: Thumbnail generation, format conversion
- **Batch Processing**: Multiple file processing with queue management
- **Real-time Progress**: WebSocket-based progress tracking

### **Archive & Logs System**
- Comprehensive audit trail
- System backup creation and management
- Log aggregation and filtering
- Performance metrics collection
- Error tracking and reporting

### **Version Control**
- File versioning with history tracking
- Version comparison capabilities
- Rollback functionality
- Storage optimization for versions

### **Frontend Application**
- Modern React-based interface
- File drag-and-drop upload
- Real-time processing status
- Admin dashboard with system metrics
- Responsive design with Tailwind CSS

---

## ⚠️ **Error Handling**

### **Centralized Error System**
```javascript
// Custom error classes
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }
}

// Global error handler
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const response = {
    error: err.message,
    status: statusCode,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };
  
  logger.error('Application error', { error: err.message, stack: err.stack });
  res.status(statusCode).json(response);
};
```

### **Status Codes Used**
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing token)
- `403` - Forbidden (invalid token/permissions)
- `404` - Not Found
- `413` - Payload Too Large
- `415` - Unsupported Media Type
- `429` - Too Many Requests (rate limiting)
- `500` - Internal Server Error

### **Logging Strategy**
- **Structured Logging**: JSON format with context
- **Log Levels**: Error, Warn, Info, Debug
- **File Rotation**: Automatic log file rotation
- **Real-time Monitoring**: Health checks and metrics

---

## 📚 **API Documentation**

### **Authentication Endpoints**
```http
# Generate test token
POST /api/auth/login
Content-Type: application/json

{
  "userId": "test-user",
  "role": "user" // or "admin"
}

# Verify token
GET /api/auth/me
Authorization: Bearer <token>
```

### **File Upload**
```http
# Upload file
POST /api/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <file_data>
metadata: {"description": "File description"}
```

### **File Management**
```http
# List files
GET /api/upload/files
Authorization: Bearer <token>

# Get file details
GET /api/upload/files/:id
Authorization: Bearer <token>

# Download file
GET /api/upload/files/:id/download
Authorization: Bearer <token>

# Delete file
DELETE /api/upload/files/:id
Authorization: Bearer <token>
```

### **Processing Logs (Puzzle)**
```http
# Basic access
GET /api/processing-logs
Authorization: Bearer <token>

# Admin access
GET /api/processing-logs?access=PROC_LOGS_ADMIN_2024

# System access
GET /api/processing-logs
X-System-Key: system-processing-key-2024
```

### **Archive System (Puzzle)**
```http
# Archive listing
GET /api/archive
Authorization: Bearer <token>

# Master key access
GET /api/archive?master_key=ARCHIVE_MASTER_2024

# Download archive
GET /api/archive/download/:filename
X-Archive-Key: ARCHIVE_MASTER_2024
```

### **Virus Scanning**
```http
# Scan file
POST /api/virus-scan/scan
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <file_data>
```

### **System Health**
```http
# Health check
GET /health

# Memory status
GET /memory-status

# System metrics (dev only)
GET /metrics
```

---

## 🧩 **Multi-Layered Puzzle Chain**

This assessment includes a complex puzzle chain that tests understanding of HTTP headers, API exploration, encoding, and security mechanisms:

### **Puzzle 1: Hidden Header Discovery** 🔍
**Challenge**: Discover the hidden metadata hint in HTTP response headers.

**Solution**:
1. Make any API request (e.g., `GET /api/upload/files`)
2. Check the response headers for `X-Hidden-Metadata`
3. Header value: `check_file_processing_logs_endpoint`

### **Puzzle 2: Processing Logs Access** 📊
**Challenge**: Access the processing logs endpoint with elevated permissions.

**Solution**:
1. Use hint from Puzzle 1 to find `/api/processing-logs` endpoint
2. Try different access methods:
   - Basic: `GET /api/processing-logs` (requires JWT)
   - Admin: `GET /api/processing-logs?access=PROC_LOGS_ADMIN_2024`
   - System: `GET /api/processing-logs` with header `X-System-Key: system-processing-key-2024`

### **Puzzle 3: Base64 Decoding & Secret Hint** 🔓
**Challenge**: Decode the Base64 secret message from system-level access.

**Solution**:
1. Access processing logs with system key (Puzzle 2)
2. Look for `secretHint` field in response
3. Decode Base64 string: `VGhlIGZpbmFsIHNlY3JldCBpc...`
4. Result: "The final secret is hidden in the archive download endpoint with key: ARCHIVE_MASTER_2024"

### **Puzzle 4: Archive Master Access & XOR Message** 🏆
**Challenge**: Access the archive system and decrypt the final XOR-encrypted message.

**Solution**:
1. Use discovered key: `GET /api/archive?master_key=ARCHIVE_MASTER_2024`
2. Access archive download: `GET /api/archive/download/audit-trail.zip` with header `X-Archive-Key: ARCHIVE_MASTER_2024`
3. XOR decrypt the final message using key `ARCHIVE_MASTER_2024`
4. Final achievement unlocked: **FILE_MASTER_ACHIEVEMENT_2024**

### **Complete Puzzle Solution Flow**
```bash
# 1. Discover hidden header
curl -H "Authorization: Bearer <token>" http://localhost:8888/api/upload/files -I

# 2. Access processing logs (system level)
curl -H "X-System-Key: system-processing-key-2024" http://localhost:8888/api/processing-logs

# 3. Decode Base64 hint (use online decoder or command line)
echo "VGhlIGZpbmFsIHNlY3JldCBpc..." | base64 -d

# 4. Access archive with master key
curl -H "X-Archive-Key: ARCHIVE_MASTER_2024" "http://localhost:8888/api/archive?master_key=ARCHIVE_MASTER_2024"

# 5. Download final archive
curl -H "X-Archive-Key: ARCHIVE_MASTER_2024" http://localhost:8888/api/archive/download/audit-trail.zip
```

---

## 🔄 **Security Improvements Table**

| Security Aspect | **Before** | **After** | Impact |
|------------------|------------|-----------|---------|
| **File Validation** | ❌ No validation | ✅ MIME + Magic bytes + Content validation | **Critical** |
| **File Size** | ❌ No limits | ✅ 10MB limit + Memory monitoring | **High** |
| **Authentication** | ❌ Open access | ✅ JWT required for all operations | **Critical** |
| **File Names** | ❌ User-controlled | ✅ UUID-based secure naming | **High** |
| **Virus Scanning** | ❌ Not implemented | ✅ ClamAV + Pattern detection | **High** |
| **Rate Limiting** | ❌ No protection | ✅ IP-based rate limiting (dev/prod) | **Medium** |
| **Input Sanitization** | ❌ Raw input | ✅ XSS + Path traversal protection | **High** |
| **Error Handling** | ❌ Exposed stack traces | ✅ Centralized + Sanitized responses | **Medium** |
| **Access Control** | ❌ No ownership checks | ✅ User ownership + Role-based access | **Critical** |
| **Security Headers** | ❌ Basic setup | ✅ Helmet + CSP + HSTS | **Medium** |
| **File Encryption** | ❌ Plain storage | ✅ AES-256-GCM encryption support | **High** |
| **Logging & Monitoring** | ❌ Basic console logs | ✅ Structured logging + Audit trail | **Medium** |

---

## 🧪 **Testing Instructions**

### **Using Bruno/Postman Collection**
1. Import the provided `postman-collection.json`
2. Set environment variables:
   - `baseUrl`: `http://localhost:8888`
   - `token`: Generate via `/api/auth/login`

### **Terminal Testing**

#### **1. Authentication**
```bash
# Generate user token
curl -X POST http://localhost:8888/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId": "test-user", "role": "user"}'

# Generate admin token  
curl -X POST http://localhost:8888/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"userId": "admin-user", "role": "admin"}'
```

#### **2. File Upload**
```bash
# Upload a test file
curl -X POST http://localhost:8888/api/upload \
  -H "Authorization: Bearer <your-token>" \
  -F "file=@test-file.pdf"
```

#### **3. Security Testing**
```bash
# Test rate limiting (repeat rapidly)
for i in {1..20}; do
  curl http://localhost:8888/api/upload/files \
    -H "Authorization: Bearer <token>"
done

# Test file type validation
curl -X POST http://localhost:8888/api/upload \
  -H "Authorization: Bearer <token>" \
  -F "file=@malicious.exe"

# Test virus scanning
curl -X POST http://localhost:8888/api/virus-scan/scan \
  -H "Authorization: Bearer <token>" \
  -F "file=@suspicious-file.txt"
```

#### **4. Puzzle Chain Testing**
```bash
# Solve the complete puzzle chain
# Step 1: Hidden header discovery
curl -I http://localhost:8888/api/upload/files \
  -H "Authorization: Bearer <token>"

# Step 2: Processing logs access
curl -H "X-System-Key: system-processing-key-2024" \
  http://localhost:8888/api/processing-logs

# Step 3: Archive master access
curl -H "X-Archive-Key: ARCHIVE_MASTER_2024" \
  "http://localhost:8888/api/archive?master_key=ARCHIVE_MASTER_2024"
```

#### **5. Error Handling Verification**
```bash
# Test various error scenarios
curl http://localhost:8888/api/upload/files/invalid-id \
  -H "Authorization: Bearer <token>"

curl -X POST http://localhost:8888/api/upload \
  -H "Authorization: Bearer invalid-token" \
  -F "file=@test.pdf"
```

### **Frontend Testing**

#### **Access Points**
- **Main Application**: `http://localhost:5173` (Vite dev server)
- **Backend API**: `http://localhost:8888`

#### **Test Credentials**
```javascript
// User account
{
  "userId": "test-user",
  "role": "user"
}

// Admin account
{
  "userId": "admin-user", 
  "role": "admin"
}
```

#### **Frontend Features to Test**
1. **Authentication Flow**: Login/logout functionality
2. **File Upload**: Drag-and-drop interface with progress tracking
3. **File Management**: View, download, delete files
4. **Admin Panel**: System metrics and user management (admin only)
5. **Responsive Design**: Test on different screen sizes
6. **Error Handling**: Network errors, invalid files, etc.

---

## 🎯 **Frontend Application**

### **Features**
- **Modern React Interface**: Built with React 18 and Vite
- **Responsive Design**: Tailwind CSS with mobile-first approach
- **File Upload**: Drag-and-drop with react-dropzone
- **Real-time Updates**: Live file processing status
- **Role-based UI**: Different interfaces for users and admins
- **Toast Notifications**: User feedback with react-hot-toast
- **Router Integration**: Multi-page application with react-router-dom

### **Access & Navigation**
- **Dashboard**: System overview and quick actions
- **File Upload**: Secure file upload interface  
- **File Manager**: Browse and manage uploaded files
- **File Sharing**: Share files with expiration controls
- **Admin Panel**: System monitoring and management (admin only)

### **Component Architecture**
```
src/
├── components/
│   ├── Header.jsx              # Application header
│   └── Navigation.jsx          # Main navigation
├── pages/
│   ├── Dashboard.jsx           # Main dashboard
│   ├── FileUpload.jsx          # File upload interface
│   ├── FileManager.jsx         # File management
│   ├── FileSharing.jsx         # File sharing controls
│   └── AdminPanel.jsx          # Admin dashboard
├── services/
│   ├── apiClient.js            # Axios API client
│   └── authService.js          # Authentication service
└── contexts/
    └── AuthContext.jsx         # Global auth state
```

### **Environment Setup**
The frontend automatically connects to the backend API running on `http://localhost:8888`. No additional configuration required for development.

---

## 🏆 **Conclusion / Achievement Summary**

This File Upload/Processing API assessment successfully demonstrates:

### **✅ Core Requirements Completed**
- **Security Implementation**: All critical vulnerabilities addressed with enterprise-grade solutions
- **Error Handling**: Comprehensive error management with proper HTTP status codes and logging
- **File Processing**: Advanced processing capabilities for multiple file types
- **Authentication & Authorization**: JWT-based security with role-based access control

### **🚀 Advanced Features Delivered**
- **Multi-layered Puzzle System**: Complex challenge requiring deep API understanding
- **React Frontend**: Modern, responsive user interface
- **Production Security**: Enhanced middleware for production environments
- **Monitoring & Logging**: Comprehensive system observability
- **Backup & Recovery**: Data protection and system resilience

### **🎯 Technical Excellence**
- **Code Quality**: Well-structured, modular codebase with separation of concerns
- **Scalability**: Queue-based processing with horizontal scaling support
- **Performance**: Memory monitoring, rate limiting, and optimization
- **Security**: Defense-in-depth approach with multiple security layers

### **🧩 Puzzle Master Achievement**
Successfully solving the complete puzzle chain demonstrates:
- HTTP header analysis skills
- API exploration and discovery techniques  
- Encoding/decoding proficiency (Base64, XOR)
- Security mechanism understanding
- Systematic problem-solving approach

**Final Achievement Unlocked**: 🏆 **FILE_MASTER_ACHIEVEMENT_2024**

---

## 📞 **Support & Contact**

For technical questions or support:
- Check the logs in `/logs` directory
- Use `/health` endpoint for system status
- Review error responses for detailed debugging information
- Examine the comprehensive test cases in the Postman collection
- Processing pipeline design
- Performance optimization techniques

**Good luck building a secure, robust file processing system! 🚀📁**
