import React, { useState } from 'react'
import { apiClient } from '../services/apiClient'
import toast from 'react-hot-toast'

const FileVersions = () => {
  const [fileId, setFileId] = useState('')
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(false)

  const loadVersions = async () => {
    if (!fileId.trim()) {
      toast.error('Please enter a file ID')
      return
    }

    setLoading(true)
    try {
      const response = await apiClient.get(`/api/versions/${fileId}`)
      setVersions(response.data.versions || [])
      if (response.data.versions?.length === 0) {
        toast.info('No versions found for this file')
      } else {
        toast.success(`Found ${response.data.versions.length} versions`)
      }
    } catch (error) {
      toast.error(`Failed to load versions: ${error.response?.data?.error || error.message}`)
      setVersions([])
    } finally {
      setLoading(false)
    }
  }

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h1 className="card-title">
            <i className="fas fa-code-branch"></i>
            File Versions
          </h1>
        </div>
        <p className="text-gray-600">
          View and manage different versions of your files with comprehensive version history.
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-search"></i>
            Load File Versions
          </h2>
        </div>
        
        <div className="flex gap-4">
          <div className="flex-1">
            <input
              type="text"
              className="form-input"
              placeholder="Enter File ID (e.g., file-001)"
              value={fileId}
              onChange={(e) => setFileId(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && loadVersions()}
            />
          </div>
          <button
            onClick={loadVersions}
            disabled={loading || !fileId.trim()}
            className="btn btn-primary"
          >
            <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-search'}`}></i>
            {loading ? 'Loading...' : 'Load Versions'}
          </button>
        </div>
      </div>

      {versions.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <i className="fas fa-history"></i>
              Version History for {fileId}
            </h2>
            <span className="badge badge-info">{versions.length} versions</span>
          </div>

          <div className="space-y-4">
            {versions.map((version, index) => (
              <div key={version.versionId} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                      <span className="text-blue-600 font-medium text-sm">v{version.versionNumber}</span>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-800">{version.originalName}</h3>
                      <p className="text-sm text-gray-500">
                        Created by {version.createdBy} • {new Date(version.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <span className="badge badge-success">Active</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                  <div>
                    <span className="text-gray-600 text-sm">Size:</span>
                    <div className="font-medium">{formatFileSize(version.size)}</div>
                  </div>
                  <div>
                    <span className="text-gray-600 text-sm">Type:</span>
                    <div className="font-medium">{version.mimetype}</div>
                  </div>
                  <div>
                    <span className="text-gray-600 text-sm">Version ID:</span>
                    <div className="font-mono text-sm">{version.versionId}</div>
                  </div>
                </div>

                {version.changeDescription && (
                  <div className="mb-3">
                    <span className="text-gray-600 text-sm">Changes:</span>
                    <p className="text-gray-800 mt-1">{version.changeDescription}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => window.open(version.secureUrl, '_blank')}
                    className="btn btn-sm btn-primary"
                  >
                    <i className="fas fa-download"></i>
                    Download
                  </button>
                  <button className="btn btn-sm btn-outline">
                    <i className="fas fa-eye"></i>
                    Preview
                  </button>
                  <button className="btn btn-sm btn-outline">
                    <i className="fas fa-undo"></i>
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && versions.length === 0 && fileId && (
        <div className="card">
          <div className="text-center py-8">
            <i className="fas fa-code-branch text-gray-300 text-4xl mb-4"></i>
            <h3 className="text-lg font-medium text-gray-600 mb-2">No versions found</h3>
            <p className="text-gray-500">
              The file ID "{fileId}" doesn't have any versions or doesn't exist.
            </p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-info-circle"></i>
            Version Control Features
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-gray-800 mb-3">Available Actions</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <i className="fas fa-download text-blue-500"></i>
                <span>Download any version</span>
              </div>
              <div className="flex items-center gap-3">
                <i className="fas fa-eye text-green-500"></i>
                <span>Preview version content</span>
              </div>
              <div className="flex items-center gap-3">
                <i className="fas fa-undo text-orange-500"></i>
                <span>Restore previous versions</span>
              </div>
              <div className="flex items-center gap-3">
                <i className="fas fa-code-branch text-purple-500"></i>
                <span>Compare version differences</span>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="font-medium text-gray-800 mb-3">Sample File IDs</h3>
            <div className="space-y-2">
              <button
                onClick={() => setFileId('file-001')}
                className="block w-full text-left p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
              >
                <code className="text-blue-600">file-001</code>
                <span className="text-gray-600 ml-2">- Sample PDF document</span>
              </button>
              <button
                onClick={() => setFileId('file-002')}
                className="block w-full text-left p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
              >
                <code className="text-blue-600">file-002</code>
                <span className="text-gray-600 ml-2">- Company data CSV</span>
              </button>
              <button
                onClick={() => setFileId('file-003')}
                className="block w-full text-left p-2 bg-gray-50 rounded hover:bg-gray-100 transition-colors"
              >
                <code className="text-blue-600">file-003</code>
                <span className="text-gray-600 ml-2">- Sample image file</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FileVersions