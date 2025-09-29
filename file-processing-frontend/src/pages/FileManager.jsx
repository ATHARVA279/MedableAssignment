import React, { useState, useEffect } from 'react';
import { apiClient } from '../services/apiClient';
import toast from 'react-hot-toast';

const FileManager = () => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ search: '', status: '', page: 1, limit: 20 });
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    loadFiles();
  }, [filters]);

  const loadFiles = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.search) params.append('search', filters.search);
      if (filters.status) params.append('status', filters.status);
      params.append('page', filters.page);
      params.append('limit', filters.limit);

      const response = await apiClient.get(`/api/upload?${params}`);
      setFiles(response.data.files || []);
    } catch (error) {
      toast.error(`Failed to load files: ${error.response?.data?.error || error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = async (fileId) => {
    try {
      const response = await apiClient.get(`/api/upload/${fileId}/download`);
      if (response.data.secureUrl) {
        window.open(response.data.secureUrl, '_blank');
        toast.success('Download started');
      }
    } catch (error) {
      toast.error(`Download failed: ${error.response?.data?.error || error.message}`);
    }
  };

  const deleteFile = async (fileId) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    try {
      await apiClient.delete(`/api/upload/${fileId}`);
      toast.success('File deleted successfully');
      loadFiles();
    } catch (error) {
      toast.error(`Delete failed: ${error.response?.data?.error || error.message}`);
    }
  };

  const viewFileDetails = async (fileId) => {
    try {
      const response = await apiClient.get(`/api/upload/${fileId}`);
      setSelectedFile(response.data);
    } catch (error) {
      toast.error(`Failed to load file details: ${error.response?.data?.error || error.message}`);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (mimetype) => {
    if (mimetype.startsWith('image/')) return 'fas fa-image file-icon image';
    if (mimetype === 'application/pdf') return 'fas fa-file-pdf file-icon pdf';
    if (mimetype === 'text/csv') return 'fas fa-file-csv file-icon csv';
    return 'fas fa-file file-icon other';
  };

  const getStatusBadge = (status) => {
    const badges = {
      uploaded: 'badge-warning',
      processing: 'badge-info',
      processed: 'badge-success',
      error: 'badge-error'
    };
    return badges[status] || 'badge-info';
  };

  return (
    <div className="file-manager">
      <div className="card">
        <div className="card-header">
          <h1 className="card-title"><i className="fas fa-folder-open"></i> File Manager</h1>
          <button onClick={loadFiles} disabled={loading} className="btn btn-outline">
            <i className={`fas fa-sync ${loading ? 'fa-spin' : ''}`}></i> Refresh
          </button>
        </div>
        <p className="card-description">Manage your uploaded files, view details, download, and organize your content.</p>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title"><i className="fas fa-filter"></i> Filters</h2>
        </div>
        <div className="filters-grid">
          <div className="form-group">
            <label>Search Files</label>
            <input
              type="text"
              placeholder="Search by filename..."
              value={filters.search}
              onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value, page: 1 }))}
            />
          </div>
          <div className="form-group">
            <label>Status Filter</label>
            <select
              value={filters.status}
              onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value, page: 1 }))}
            >
              <option value="">All Status</option>
              <option value="uploaded">Uploaded</option>
              <option value="processing">Processing</option>
              <option value="processed">Processed</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div className="form-group">
            <label>Items per Page</label>
            <select
              value={filters.limit}
              onChange={(e) => setFilters(prev => ({ ...prev, limit: parseInt(e.target.value), page: 1 }))}
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </div>
        </div>
      </div>

      {/* Files Grid */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title"><i className="fas fa-files"></i> Your Files ({files.length})</h2>
        </div>
        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-folder-open empty-icon"></i>
            <h3>No files found</h3>
            <p>{filters.search || filters.status ? 'Try adjusting your filters' : 'Upload your first file to get started'}</p>
          </div>
        ) : (
          <div className="card-grid">
            {files.map(file => (
              <div key={file.id} className="card file-card">
                <div className="file-header">
                  <div className="file-info">
                    <i className={getFileIcon(file.mimetype)}></i>
                    <div>
                      <h3>{file.originalName}</h3>
                      <p>{formatFileSize(file.size)} • {new Date(file.uploadDate).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <span className={`badge ${getStatusBadge(file.status)}`}>{file.status}</span>
                </div>
                <div className="file-meta">
                  <div><span>Type:</span> <span>{file.mimetype}</span></div>
                  <div><span>ID:</span> <span>{file.id}</span></div>
                </div>
                <div className="file-actions">
                  <button onClick={() => viewFileDetails(file.id)} className="btn btn-outline">Details</button>
                  <button onClick={() => downloadFile(file.id)} className="btn btn-primary">Download</button>
                  <button onClick={() => deleteFile(file.id)} className="btn btn-danger">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedFile && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-header">
              <h2><i className="fas fa-info-circle"></i> File Details</h2>
              <button onClick={() => setSelectedFile(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="modal-section">
                <h3>Basic Information</h3>
                <div className="modal-info">
                  <div><span>Name:</span> <span>{selectedFile.originalName}</span></div>
                  <div><span>ID:</span> <span>{selectedFile.id}</span></div>
                  <div><span>Size:</span> <span>{formatFileSize(selectedFile.size)}</span></div>
                  <div><span>Type:</span> <span>{selectedFile.mimetype}</span></div>
                  <div><span>Status:</span> <span className={`badge ${getStatusBadge(selectedFile.status)}`}>{selectedFile.status}</span></div>
                  <div><span>Uploaded:</span> <span>{new Date(selectedFile.uploadDate).toLocaleString()}</span></div>
                </div>
              </div>
              {selectedFile.processingResult && (
                <div className="modal-section">
                  <h3>Processing Result</h3>
                  <pre>{JSON.stringify(selectedFile.processingResult, null, 2)}</pre>
                </div>
              )}
              <div className="modal-actions">
                <button onClick={() => downloadFile(selectedFile.id)} className="btn btn-primary">Download File</button>
                <button onClick={() => { deleteFile(selectedFile.id); setSelectedFile(null) }} className="btn btn-danger">Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileManager;
