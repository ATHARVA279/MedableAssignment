import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { apiClient } from '../services/apiClient'
import toast from 'react-hot-toast'

const FileUpload = () => {
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadOptions, setUploadOptions] = useState({
    createVersion: false,
    parentFileId: '',
    versionDescription: ''
  })

  const onDrop = useCallback(async (acceptedFiles) => {
    if (acceptedFiles.length === 0) return
    await handleFileUpload(acceptedFiles[0])
  }, [uploadOptions])

  const { getRootProps, getInputProps, isDragActive, acceptedFiles } = useDropzone({
    onDrop,
    multiple: false,
    maxSize: 10 * 1024 * 1024, // 10MB
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'application/pdf': ['.pdf'],
      'text/csv': ['.csv']
    }
  })

  const handleFileUpload = async (file) => {
    if (!file) return

    setUploading(true)
    setUploadProgress(0)
    setUploadResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      if (uploadOptions.createVersion) {
        formData.append('createVersion', 'true')
        if (uploadOptions.parentFileId) formData.append('parentFileId', uploadOptions.parentFileId)
        if (uploadOptions.versionDescription) formData.append('versionDescription', uploadOptions.versionDescription)
      }

      const response = await apiClient.uploadFile(
        '/api/upload',
        formData,
        (progress) => setUploadProgress(progress)
      )

      setUploadResult(response.data)
      toast.success('File uploaded successfully!')

      // Reset form
      setUploadOptions({
        createVersion: false,
        parentFileId: '',
        versionDescription: ''
      })

    } catch (error) {
      const errorMessage = error.response?.data?.error || error.message || 'Upload failed'
      toast.error(`Upload failed: ${errorMessage}`)
      setUploadResult({ error: errorMessage })
    } finally {
      setUploading(false)
      setTimeout(() => setUploadProgress(0), 2000)
    }
  }

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getFileIcon = (type) => {
    if (type.startsWith('image/')) return 'fas fa-image text-blue-500'
    if (type === 'application/pdf') return 'fas fa-file-pdf text-red-500'
    if (type === 'text/csv') return 'fas fa-file-csv text-green-500'
    return 'fas fa-file text-gray-500'
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="card">
        <div className="card-header">
          <h1 className="card-title">
            <i className="fas fa-cloud-upload-alt"></i>
            File Upload
          </h1>
        </div>
        <p className="text-gray-600">
          Upload files securely to the cloud. Supported formats: JPEG, PNG, PDF, CSV (Max size: 10MB)
        </p>
      </div>

      {/* Upload Options */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-cog"></i>
            Upload Options
          </h2>
        </div>
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="createVersion"
              checked={uploadOptions.createVersion}
              onChange={(e) => setUploadOptions(prev => ({ ...prev, createVersion: e.target.checked }))}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <label htmlFor="createVersion" className="font-medium text-gray-700">
              Create as new version of existing file
            </label>
          </div>

          {uploadOptions.createVersion && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 ml-7">
              <div className="form-group">
                <label className="form-label">Parent File ID</label>
                <input
                  type="text"
                  className="form-input"
                  value={uploadOptions.parentFileId}
                  onChange={(e) => setUploadOptions(prev => ({ ...prev, parentFileId: e.target.value }))}
                  placeholder="Enter parent file ID"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Version Description</label>
                <input
                  type="text"
                  className="form-input"
                  value={uploadOptions.versionDescription}
                  onChange={(e) => setUploadOptions(prev => ({ ...prev, versionDescription: e.target.value }))}
                  placeholder="Describe the changes"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* File Drop Zone */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-upload"></i>
            Select File
          </h2>
        </div>

        <div
          {...getRootProps()}
          className={`file-drop-zone ${isDragActive ? 'dragover' : ''} ${uploading ? 'disabled' : ''}`}
        >
          <input {...getInputProps()} />
          <div className="file-drop-icon">
            <i className={uploading ? 'fas fa-spinner fa-spin' : 'fas fa-cloud-upload-alt'}></i>
          </div>
          <div className="file-drop-text">
            {uploading
              ? 'Uploading...'
              : isDragActive
                ? 'Drop the file here'
                : acceptedFiles.length > 0
                  ? `Selected: ${acceptedFiles[0].name}`
                  : 'Drag & drop a file here, or click to select'}
          </div>
          <div className="file-drop-subtext">
            {!uploading && (
              <>
                Supported: JPEG, PNG, PDF, CSV • Max size: 10MB
                {acceptedFiles.length > 0 && (
                  <div className="mt-2 text-blue-600 font-medium">
                    {formatFileSize(acceptedFiles[0].size)} • {acceptedFiles[0].type}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Upload Progress */}
        {uploading && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">{acceptedFiles[0]?.name}</span>
              <span className="text-sm text-gray-500">{uploadProgress}%</span>
            </div>
            <div className="progress-container">
              <div className="progress-bar" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          </div>
        )}

        {/* Manual Upload Button */}
        {acceptedFiles.length > 0 && !uploading && (
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => handleFileUpload(acceptedFiles[0])}
              className="btn btn-primary btn-lg"
            >
              <i className="fas fa-upload"></i> Upload {acceptedFiles[0].name}
            </button>
          </div>
        )}
      </div>

      {/* Upload Result */}
      {uploadResult && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <i className={`fas ${uploadResult.error ? 'fa-exclamation-triangle' : 'fa-check-circle'}`}></i>
              Upload Result
            </h2>
          </div>

          {uploadResult.error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <i className="fas fa-exclamation-circle text-red-500 text-xl"></i>
                <div>
                  <h3 className="font-medium text-red-800">Upload Failed</h3>
                  <p className="text-red-600 mt-1">{uploadResult.error}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <i className="fas fa-check-circle text-green-500 text-xl"></i>
                  <div>
                    <h3 className="font-medium text-green-800">Upload Successful</h3>
                    <p className="text-green-600 mt-1">File uploaded and processing started</p>
                  </div>
                </div>
              </div>

              {/* File Details */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-800 mb-3">File Details</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-gray-600">File ID:</span><span className="font-mono text-sm">{uploadResult.file?.id}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Name:</span><span className="font-medium">{uploadResult.file?.originalName}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Size:</span><span>{formatFileSize(uploadResult.file?.size || 0)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Type:</span><span className="flex items-center gap-2"><i className={getFileIcon(uploadResult.file?.mimetype || '')}></i>{uploadResult.file?.mimetype}</span></div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-gray-600">Status:</span><span className="badge badge-processing">{uploadResult.file?.status || 'uploaded'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Encrypted:</span><span className={`badge ${uploadResult.encryption?.encrypted ? 'badge-success' : 'badge-info'}`}>{uploadResult.encryption?.encrypted ? 'Yes' : 'No'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-600">Storage:</span><span className="badge badge-info">Cloud</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default FileUpload
