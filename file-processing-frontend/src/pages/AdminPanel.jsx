import React, { useState, useEffect } from 'react'
import { apiClient } from '../services/apiClient'
import toast from 'react-hot-toast'

const AdminPanel = () => {
  const [systemHealth, setSystemHealth] = useState(null)
  const [accessLogs, setAccessLogs] = useState([])
  const [memoryStats, setMemoryStats] = useState([])
  const [loading, setLoading] = useState({})

  useEffect(() => {
    loadSystemHealth()
    loadMemoryStats()
  }, [])

  const updateLoading = (key, value) => {
    setLoading(prev => ({ ...prev, [key]: value }))
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    if (!bytes || bytes < 0) return '0 Bytes'
    
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const loadSystemHealth = async () => {
    updateLoading('health', true)
    try {
      const response = await apiClient.get('/api/admin/health/detailed')
      setSystemHealth(response.data)
    } catch (error) {
      toast.error(`Failed to load system health: ${error.response?.data?.error || error.message}`)
    } finally {
      updateLoading('health', false)
    }
  }

  const loadMemoryStats = async () => {
    updateLoading('memory', true)
    try {
      const response = await apiClient.get('/api/admin/memory-stats')
      const { currentStats, report } = response.data || {}
      
      // Transform the memory stats into the expected format for the UI
      const transformedStats = []
      
      if (currentStats) {
        // System Memory
        if (currentStats.system && typeof currentStats.system.percentage === 'number') {
          transformedStats.push({
            name: 'System Memory',
            status: currentStats.system.percentage > 90 ? 'error' : 
                   currentStats.system.percentage > 80 ? 'warning' : 'healthy',
            usage: `${currentStats.system.percentage.toFixed(1)}%`,
            description: `${formatBytes(currentStats.system.used || 0)} / ${formatBytes(currentStats.system.total || 0)}`
          })
        }
        
        // Heap Memory
        if (currentStats.heap && typeof currentStats.heap.percentage === 'number') {
          transformedStats.push({
            name: 'Heap Memory',
            status: currentStats.heap.percentage > 90 ? 'error' : 
                   currentStats.heap.percentage > 80 ? 'warning' : 'healthy',
            usage: `${currentStats.heap.percentage.toFixed(1)}%`,
            description: `${formatBytes(currentStats.heap.used || 0)} / ${formatBytes(currentStats.heap.total || 0)}`
          })
        }
        
        // Active Uploads
        if (report?.summary && typeof report.summary.activeUploads === 'number') {
          transformedStats.push({
            name: 'Active Uploads',
            status: report.summary.activeUploads > 10 ? 'warning' : 'healthy',
            usage: report.summary.activeUploads.toString(),
            description: `Memory: ${report.summary.totalUploadMemory || '0 Bytes'}`
          })
        }
        
        // Upload Memory Usage
        if (currentStats.limits && currentStats.limits.maxTotalMemoryUsage) {
          const current = currentStats.current || 0
          const uploadMemoryPercent = (current / currentStats.limits.maxTotalMemoryUsage) * 100
          transformedStats.push({
            name: 'Upload Memory',
            status: uploadMemoryPercent > 90 ? 'error' : 
                   uploadMemoryPercent > 80 ? 'warning' : 'healthy',
            usage: `${uploadMemoryPercent.toFixed(1)}%`,
            description: `${formatBytes(current)} / ${formatBytes(currentStats.limits.maxTotalMemoryUsage)}`
          })
        }
      }
      
      // If no stats were found, add a default message
      if (transformedStats.length === 0) {
        transformedStats.push({
          name: 'Memory Monitor',
          status: 'warning',
          usage: 'N/A',
          description: 'Memory statistics not available'
        })
      }
      
      setMemoryStats(transformedStats)
    } catch (error) {
      toast.error(`Failed to load memory stats: ${error.response?.data?.error || error.message}`)
      // Set an error state so the UI doesn't crash
      setMemoryStats([{
        name: 'Memory Monitor',
        status: 'error',
        usage: 'Error',
        description: 'Failed to load memory statistics'
      }])
    } finally {
      updateLoading('memory', false)
    }
  }

  const loadAccessLogs = async (timeRange = '24h') => {
    updateLoading('logs', true)
    try {
      const response = await apiClient.get(`/api/admin/access-logs?timeRange=${timeRange}`)
      setAccessLogs(response.data.statistics || [])
    } catch (error) {
      toast.error(`Failed to load access logs: ${error.response?.data?.error || error.message}`)
    } finally {
      updateLoading('logs', false)
    }
  }

  const createBackup = async () => {
    updateLoading('backup', true)
    try {
      await apiClient.post('/api/admin/backup/create')
      toast.success('Backup created successfully!')
      loadSystemHealth()
    } catch (error) {
      toast.error(`Backup failed: ${error.response?.data?.error || error.message}`)
    } finally {
      updateLoading('backup', false)
    }
  }

  const testVirusScanner = async () => {
    updateLoading('virus', true)
    try {
      await apiClient.post('/api/admin/virus-scanner/test')
      toast.success('Virus scanner test completed successfully!')
    } catch (error) {
      toast.error(`Virus scanner test failed: ${error.response?.data?.error || error.message}`)
    } finally {
      updateLoading('virus', false)
    }
  }

  const getHealthStatusColor = (status) => {
    switch (status) {
      case 'healthy': return 'badge-green'
      case 'warning': return 'badge-yellow'
      case 'error': return 'badge-red'
      default: return 'badge-gray'
    }
  }

  const getHealthIcon = (status) => {
    switch (status) {
      case 'healthy': return 'fas fa-check-circle'
      case 'warning': return 'fas fa-exclamation-triangle'
      case 'error': return 'fas fa-times-circle'
      default: return 'fas fa-question-circle'
    }
  }

  return (
    <div className="admin-panel">
      {/* Admin Panel Header */}
      <div className="card">
        <div className="card-header">
          <h1 className="card-title">
            <i className="fas fa-shield-alt"></i> Admin Panel
          </h1>
          <button onClick={loadSystemHealth} className="btn btn-outline">
            <i className={`fas fa-sync ${loading.health ? 'spin' : ''}`}></i> Refresh
          </button>
        </div>
        <p className="card-description">
          System administration dashboard with health monitoring, backup management, and security tools.
        </p>
      </div>

      {/* System Health Overview */}
      {systemHealth && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <i className="fas fa-heartbeat"></i> System Health
            </h2>
            <span className={`badge ${getHealthStatusColor(systemHealth.overall)}`}>
              <i className={getHealthIcon(systemHealth.overall)}></i> {systemHealth.overall}
            </span>
          </div>

          <div className="grid-4">
            {/* Memory */}
            <div className="card-item">
              <div className="item-header">
                <h3>Memory</h3>
                <span className={`badge ${getHealthStatusColor(systemHealth.memory.status)}`}>
                  {systemHealth.memory.status}
                </span>
              </div>
              <div className="item-value">{systemHealth.memory.usage}</div>
              <div className="item-desc">{systemHealth.memory.activeUploads} active uploads</div>
            </div>

            {/* Virus Scanner */}
            <div className="card-item">
              <div className="item-header">
                <h3>Virus Scanner</h3>
                <span className={`badge ${getHealthStatusColor(systemHealth.virusScanner.status)}`}>
                  {systemHealth.virusScanner.status}
                </span>
              </div>
              <div className="item-desc">Available: {systemHealth.virusScanner.availableScanners.join(', ')}</div>
            </div>

            {/* Backup */}
            <div className="card-item">
              <div className="item-header">
                <h3>Backup</h3>
                <span className={`badge ${getHealthStatusColor(systemHealth.backup.status)}`}>
                  {systemHealth.backup.status}
                </span>
              </div>
              <div className="item-desc">
                {systemHealth.backup.totalBackups} backups
                {systemHealth.backup.lastBackup && (
                  <div>Last: {new Date(systemHealth.backup.lastBackup).toLocaleDateString()}</div>
                )}
              </div>
            </div>

            {/* Network */}
            <div className="card-item">
              <div className="item-header">
                <h3>Network</h3>
                <span className={`badge ${getHealthStatusColor(systemHealth.network.status)}`}>
                  {systemHealth.network.status}
                </span>
              </div>
              <div className="item-desc">
                {systemHealth.network.activeSessions} active sessions
                <div>{systemHealth.network.failedSessions} failed</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Memory Stats */}
      {memoryStats && Array.isArray(memoryStats) && memoryStats.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <i className="fas fa-memory"></i> Memory Stats
            </h2>
          </div>
          <div className="grid-4">
            {memoryStats.map((mem, idx) => (
              <div key={idx} className="card-item">
                <div className="item-header">
                  <h3>{mem.name}</h3>
                  <span className={`badge ${getHealthStatusColor(mem.status)}`}>{mem.status}</span>
                </div>
                <div className="item-value">{mem.usage}</div>
                <div className="item-desc">{mem.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Access Logs */}
      {accessLogs.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <i className="fas fa-list"></i> Access Logs
            </h2>
          </div>
          <div className="access-logs">
            {accessLogs.map((log, idx) => (
              <div key={idx} className="log-item">
                <span className="log-time">{new Date(log.time).toLocaleString()}</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin Actions */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title"><i className="fas fa-tools"></i> Admin Actions</h2>
        </div>
        <div className="grid-4">
          <button onClick={createBackup} disabled={loading.backup} className="btn btn-primary">
            <i className={`fas ${loading.backup ? 'fa-spinner spin' : 'fa-save'}`}></i> Create Backup
          </button>
          <button onClick={testVirusScanner} disabled={loading.virus} className="btn btn-info">
            <i className={`fas ${loading.virus ? 'fa-spinner spin' : 'fa-bug'}`}></i> Test Virus Scanner
          </button>
          <button onClick={() => loadAccessLogs('24h')} disabled={loading.logs} className="btn btn-warning">
            <i className={`fas ${loading.logs ? 'fa-spinner spin' : 'fa-list'}`}></i> Load Access Logs
          </button>
          <button onClick={loadMemoryStats} disabled={loading.memory} className="btn btn-secondary">
            <i className={`fas ${loading.memory ? 'fa-spinner spin' : 'fa-memory'}`}></i> Memory Stats
          </button>
        </div>
      </div>

      {/* Admin Warning */}
      {systemHealth?.warning && (
        <div className="card card-warning">
          <h3><i className="fas fa-exclamation-circle"></i> Warning</h3>
          <p>{systemHealth.warning}</p>
        </div>
      )}
    </div>
  )
}

export default AdminPanel
