import React, { useState, useEffect } from 'react'
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
      setSystemHealth({
        timestamp: new Date().toISOString(),
        overall: 'unavailable',
        virusScanner: { status: 'unavailable', availableScanners: [] },
        backup: { status: 'unavailable', totalBackups: 0 },
        network: { status: 'unavailable', activeSessions: 0 }
      })
      toast.info('Admin functionality is currently unavailable')
    } catch (error) {
      toast.error(`Failed to load system health: ${error.response?.data?.error || error.message}`)
    } finally {
      updateLoading('health', false)
    }
  }

  const loadMemoryStats = async () => {
    updateLoading('memory', true)
    try {
      setMemoryStats([{
        name: 'Memory Monitor',
        status: 'unavailable',
        usage: 'N/A',
        description: 'Admin functionality is currently unavailable'
      }])
      toast.info('Memory statistics are currently unavailable')
    } catch (error) {
      toast.error(`Failed to load memory stats: ${error.response?.data?.error || error.message}`)
    } finally {
      updateLoading('memory', false)
    }
  }

  const loadAccessLogs = async (timeRange = '24h') => {
    updateLoading('logs', true)
    try {
      // Admin functionality has been removed
      setAccessLogs([])
      toast.info('Access logs are currently unavailable')
    } catch (error) {
      toast.error(`Failed to load access logs: ${error.response?.data?.error || error.message}`)
    } finally {
      updateLoading('logs', false)
    }
  }

  const createBackup = async () => {
    updateLoading('backup', true)
    try {
      toast.info('Backup functionality is currently unavailable')
    } catch (error) {
      toast.error(`Backup failed: ${error.response?.data?.error || error.message}`)
    } finally {
      updateLoading('backup', false)
    }
  }

  const testVirusScanner = async () => {
    updateLoading('virus', true)
    try {
      toast.info('Virus scanner test is currently unavailable')
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
      case 'unavailable': return 'badge-gray'
      default: return 'badge-gray'
    }
  }

  const getHealthIcon = (status) => {
    switch (status) {
      case 'healthy': return 'fas fa-check-circle'
      case 'warning': return 'fas fa-exclamation-triangle'
      case 'error': return 'fas fa-times-circle'
      case 'unavailable': return 'fas fa-ban'
      default: return 'fas fa-question-circle'
    }
  }

  return (
    <div className="admin-panel">
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

            <div className="card-item">
              <div className="item-header">
                <h3>Virus Scanner</h3>
                <span className={`badge ${getHealthStatusColor(systemHealth.virusScanner.status)}`}>
                  {systemHealth.virusScanner.status}
                </span>
              </div>
              <div className="item-desc">Available: {systemHealth.virusScanner.availableScanners.join(', ')}</div>
            </div>

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
