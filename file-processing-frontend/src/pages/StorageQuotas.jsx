import React, { useState, useEffect } from 'react'
import { apiClient } from '../services/apiClient'
import toast from 'react-hot-toast'

const StorageQuotas = () => {
  const [quotaInfo, setQuotaInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [checkForm, setCheckForm] = useState({
    fileSize: '',
    mimeType: 'image/jpeg'
  })

  useEffect(() => {
    loadQuotaInfo()
  }, [])

  const loadQuotaInfo = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/api/quotas/me')
      console.log('Quota API response:', response.data) // Debug log
      setQuotaInfo(response.data)
    } catch (error) {
      toast.error(`Failed to load quota info: ${error.response?.data?.error || error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const checkQuota = async (e) => {
    e.preventDefault()
    if (!checkForm.fileSize) {
      toast.error('Please enter file size')
      return
    }

    try {
      const response = await apiClient.post('/api/quotas/check', {
        fileSize: parseInt(checkForm.fileSize),
        mimeType: checkForm.mimeType
      })
      
      if (response.data.canUpload) {
        toast.success('Upload allowed within quota limits')
      } else {
        toast.error(`Upload denied: ${response.data.errors.join(', ')}`)
      }
    } catch (error) {
      toast.error(`Quota check failed: ${error.response?.data?.error || error.message}`)
    }
  }

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getUsageColor = (percentage) => {
    if (percentage >= 90) return 'text-red-600 bg-red-100'
    if (percentage >= 75) return 'text-orange-600 bg-orange-100'
    return 'text-green-600 bg-green-100'
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        Loading quota information...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h1 className="card-title">
            <i className="fas fa-chart-pie"></i>
            Storage Quotas
          </h1>
          <button onClick={loadQuotaInfo} className="btn btn-outline">
            <i className="fas fa-sync"></i>
            Refresh
          </button>
        </div>
        <p className="text-gray-600">
          Monitor your storage usage and manage quota limits for files and storage space.
        </p>
      </div>

      {quotaInfo && quotaInfo.quota && quotaInfo.usage && (
        <>
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <i className="fas fa-dashboard"></i>
                Quota Overview
              </h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Storage Usage */}
              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 relative">
                  <div className="w-full h-full rounded-full bg-gray-200">
                    <div 
                      className="w-full h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600"
                      style={{ 
                        clipPath: `polygon(50% 50%, 50% 0%, ${50 + ((quotaInfo.usage.storage?.percentage || 0) * 0.5)}% 0%, 100% 100%, 0% 100%)` 
                      }}
                    ></div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold text-gray-700">
                      {quotaInfo.usage.storage?.percentage || 0}%
                    </span>
                  </div>
                </div>
                <h3 className="font-medium text-gray-800">Storage Used</h3>
                <p className="text-sm text-gray-600">
                  {quotaInfo.usage.storage?.formatted?.used || '0 Bytes'} / {quotaInfo.usage.storage?.formatted?.limit || '0 Bytes'}
                </p>
              </div>

              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
                  <i className="fas fa-files text-green-600 text-2xl"></i>
                </div>
                <h3 className="font-medium text-gray-800">Files</h3>
                <p className="text-sm text-gray-600">
                  {quotaInfo.usage.files?.used || 0} / {quotaInfo.quota.maxFiles}
                </p>
              </div>

              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
                  <i className="fas fa-upload text-blue-600 text-2xl"></i>
                </div>
                <h3 className="font-medium text-gray-800">Daily Uploads</h3>
                <p className="text-sm text-gray-600">
                  {quotaInfo.usage.dailyUploads?.used || 0} / {quotaInfo.quota.maxDailyUploads}
                </p>
              </div>

              <div className="text-center">
                <div className="w-20 h-20 mx-auto mb-4 bg-purple-100 rounded-full flex items-center justify-center">
                  <i className="fas fa-weight-hanging text-purple-600 text-2xl"></i>
                </div>
                <h3 className="font-medium text-gray-800">Max File Size</h3>
                <p className="text-sm text-gray-600">
                  {formatFileSize(quotaInfo.quota.maxFileSize)}
                </p>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <i className="fas fa-chart-bar"></i>
                Detailed Usage
              </h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">Storage Usage</span>
                  <span className="text-sm text-gray-600">
                    {quotaInfo.usage.storage?.formatted?.used || '0 Bytes'} / {quotaInfo.usage.storage?.formatted?.limit || '0 Bytes'}
                  </span>
                </div>
                <div className="progress-container">
                  <div 
                    className="progress-bar"
                    style={{ width: `${quotaInfo.usage.storage?.percentage || 0}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">Files Count</span>
                  <span className="text-sm text-gray-600">
                    {quotaInfo.usage.files?.used || 0} / {quotaInfo.quota.maxFiles}
                  </span>
                </div>
                <div className="progress-container">
                  <div 
                    className="progress-bar"
                    style={{ width: `${quotaInfo.usage.files?.percentage || 0}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="font-medium">Daily Uploads</span>
                  <span className="text-sm text-gray-600">
                    {quotaInfo.usage.dailyUploads?.used || 0} / {quotaInfo.quota.maxDailyUploads}
                  </span>
                </div>
                <div className="progress-container">
                  <div 
                    className="progress-bar"
                    style={{ width: `${quotaInfo.usage.dailyUploads?.percentage || 0}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {quotaInfo.warnings && quotaInfo.warnings.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <i className="fas fa-exclamation-triangle"></i>
                  Quota Warnings
                </h2>
              </div>
              
              <div className="space-y-3">
                {quotaInfo.warnings.map((warning, index) => (
                  <div key={index} className={`p-3 rounded-lg border ${
                    warning.level === 'critical' ? 'bg-red-50 border-red-200' : 'bg-yellow-50 border-yellow-200'
                  }`}>
                    <div className="flex items-start gap-3">
                      <i className={`fas fa-exclamation-triangle ${
                        warning.level === 'critical' ? 'text-red-500' : 'text-yellow-500'
                      } mt-0.5`}></i>
                      <div>
                        <h4 className={`font-medium ${
                          warning.level === 'critical' ? 'text-red-800' : 'text-yellow-800'
                        }`}>
                          {warning.type}
                        </h4>
                        <p className={`text-sm ${
                          warning.level === 'critical' ? 'text-red-600' : 'text-yellow-600'
                        }`}>
                          {warning.message}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-calculator"></i>
            Check Upload Quota
          </h2>
        </div>
        
        <form onSubmit={checkQuota} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="form-group">
              <label className="form-label">File Size (bytes)</label>
              <input
                type="number"
                className="form-input"
                placeholder="Enter file size in bytes"
                value={checkForm.fileSize}
                onChange={(e) => setCheckForm(prev => ({ ...prev, fileSize: e.target.value }))}
                min="1"
                required
              />
              <div className="form-help">
                Example: 1048576 = 1MB, 10485760 = 10MB
              </div>
            </div>
            
            <div className="form-group">
              <label className="form-label">MIME Type</label>
              <select
                className="form-select"
                value={checkForm.mimeType}
                onChange={(e) => setCheckForm(prev => ({ ...prev, mimeType: e.target.value }))}
              >
                <option value="image/jpeg">JPEG Image</option>
                <option value="image/png">PNG Image</option>
                <option value="application/pdf">PDF Document</option>
                <option value="text/csv">CSV File</option>
              </select>
            </div>
          </div>
          
          <button type="submit" className="btn btn-primary">
            <i className="fas fa-check"></i>
            Check Quota
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <i className="fas fa-info-circle"></i>
            Quota Information
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-gray-800 mb-3">Current Limits</h3>
            {quotaInfo && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Max Storage:</span>
                  <span>{formatFileSize(quotaInfo.quota.maxStorage)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Max Files:</span>
                  <span>{quotaInfo.quota.maxFiles}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Max File Size:</span>
                  <span>{formatFileSize(quotaInfo.quota.maxFileSize)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Daily Upload Limit:</span>
                  <span>{quotaInfo.quota.maxDailyUploads}</span>
                </div>
              </div>
            )}
          </div>
          
          <div>
            <h3 className="font-medium text-gray-800 mb-3">Allowed File Types</h3>
            {quotaInfo && (
              <div className="space-y-1 text-sm">
                {quotaInfo.quota.allowedFileTypes.map((type, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <i className="fas fa-check text-green-500"></i>
                    <span>{type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default StorageQuotas