import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../services/apiClient'

const Dashboard = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [systemStats, setSystemStats] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) loadSystemStats()
  }, [user])

  const loadSystemStats = async () => {
    try {
      setLoading(true)
      const response = await apiClient.get('/health')
      setSystemStats(response.data)
    } catch (error) {
      console.error('Failed to load system stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const quickActions = [
    { title: 'Upload Files', description: 'Upload and process your files securely', icon: 'fas fa-cloud-upload-alt', color: 'from-blue-500 to-blue-600', path: '/upload', requireAuth: true },
    { title: 'Manage Files', description: 'View, download, and organize your files', icon: 'fas fa-folder-open', color: 'from-green-500 to-green-600', path: '/files', requireAuth: true },
    { title: 'Batch Processing', description: 'Process multiple files simultaneously', icon: 'fas fa-layer-group', color: 'from-purple-500 to-purple-600', path: '/batch', requireAuth: true },
    { title: 'Puzzle Challenge', description: 'Solve security puzzles and unlock achievements', icon: 'fas fa-puzzle-piece', color: 'from-orange-500 to-orange-600', path: '/puzzles', requireAuth: false }
  ]

  const features = [
    { title: 'Secure File Storage', description: 'Enterprise-grade security with encryption and access controls', icon: 'fas fa-shield-alt' },
    { title: 'Real-time Processing', description: 'Instant file processing with progress tracking', icon: 'fas fa-bolt' },
    { title: 'Version Control', description: 'Track file changes with comprehensive versioning', icon: 'fas fa-code-branch' },
    { title: 'Collaborative Sharing', description: 'Secure file sharing with expiration and access controls', icon: 'fas fa-users' },
    { title: 'Batch Operations', description: 'Process multiple files efficiently with parallel processing', icon: 'fas fa-tasks' },
    { title: 'Admin Dashboard', description: 'Comprehensive system monitoring and management tools', icon: 'fas fa-chart-line' }
  ]

  const handleQuickAction = (action) => {
    if (action.requireAuth && !user) return
    navigate(action.path)
  }

  return (
    <div className="space-y-8">

      {/* Welcome Section */}
      <div className="card text-center">
        <div className="avatar mx-auto mb-6">
          <i className="fas fa-cloud-upload-alt text-white text-3xl"></i>
        </div>
        <h1 className="text-3xl font-bold mb-4">Welcome to File Processing API</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          A comprehensive file management system with enterprise-grade security, real-time processing, and advanced collaboration features.
        </p>

        {!user && (
          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-blue-800 font-medium">
              <i className="fas fa-info-circle mr-2"></i>
              Please login to access file management features
            </p>
          </div>
        )}
      </div>

      {/* System Status */}
      {user && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title"><i className="fas fa-server"></i> System Status</h2>
            <button onClick={loadSystemStats} disabled={loading} className="btn btn-sm btn-outline">
              <i className={`fas fa-sync ${loading ? 'fa-spin' : ''}`}></i> Refresh
            </button>
          </div>

          {systemStats ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard title="System Health" value={systemStats.status || 'Healthy'} icon="fas fa-heartbeat" color="green" />
              <StatCard title="Storage" value="Cloudinary" icon="fas fa-cloud" color="blue" />
              <StatCard title="Environment" value={systemStats.environment || 'Development'} icon="fas fa-cog" color="purple" />
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="loading">
                <div className="loading-spinner"></div>
                Loading system status...
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title"><i className="fas fa-rocket"></i> Quick Actions</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action, idx) => (
            <QuickAction key={idx} action={action} user={user} onClick={() => handleQuickAction(action)} />
          ))}
        </div>
      </div>

      {/* Platform Features */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title"><i className="fas fa-star"></i> Platform Features</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, idx) => (
            <FeatureCard key={idx} feature={f} />
          ))}
        </div>
      </div>

      {/* User Info */}
      {user && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title"><i className="fas fa-user-circle"></i> User Information</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <AccountDetails user={user} />
            <UserActions user={user} />
          </div>
        </div>
      )}

    </div>
  )
}

// ---------------------- Subcomponents ----------------------
const StatCard = ({ title, value, icon, color }) => (
  <div className={`bg-${color}-50 p-4 rounded-lg border border-${color}-200`}>
    <div className="flex items-center justify-between">
      <div>
        <p className={`text-${color}-600 font-medium`}>{title}</p>
        <p className={`text-2xl font-bold text-${color}-800`}>{value}</p>
      </div>
      <i className={`${icon} text-${color}-500 text-2xl`}></i>
    </div>
  </div>
)

const QuickAction = ({ action, user, onClick }) => {
  const disabled = action.requireAuth && !user;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`quick-action-button ${disabled ? 'disabled' : ''} ${action.color}`}
    >
      <div className="qa-icon-wrapper">
        <i className={`qa-icon ${action.icon}`}></i>
        {disabled && <i className="qa-lock fas fa-lock"></i>}
      </div>
      <h3 className="qa-title">{action.title}</h3>
      <p className="qa-description">{action.description}</p>
    </button>
  );
};


const FeatureCard = ({ feature }) => (
  <div className="flex items-start gap-4 p-4 rounded-lg hover:bg-gray-50 transition-colors">
    <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
      <i className={`${feature.icon} text-white`}></i>
    </div>
    <div>
      <h3 className="font-semibold text-gray-800 mb-2">{feature.title}</h3>
      <p className="text-gray-600 text-sm">{feature.description}</p>
    </div>
  </div>
)

const AccountDetails = ({ user }) => (
  <div>
    <h3 className="font-semibold text-gray-800 mb-3">Account Details</h3>
    <div className="space-y-2">
      <div className="flex justify-between"><span className="text-gray-600">User ID:</span> <span className="font-medium">{user.userId}</span></div>
      <div className="flex justify-between"><span className="text-gray-600">Role:</span> <span className={`badge ${user.role === 'admin' ? 'badge-info' : 'badge-success'}`}>{user.role}</span></div>
      <div className="flex justify-between"><span className="text-gray-600">Session:</span> <span className="badge badge-success">Active</span></div>
    </div>
  </div>
)

const UserActions = ({ user }) => (
  <div>
    <h3 className="font-semibold text-gray-800 mb-3">Available Actions</h3>
    <div className="space-y-2">
      <ActionItem title="File Upload & Management" color="green" />
      <ActionItem title="Batch Processing" color="green" />
      <ActionItem title="File Sharing & Versions" color="green" />
      {user.role === 'admin' && <ActionItem title="Admin Panel Access" color="blue" />}
    </div>
  </div>
)

const ActionItem = ({ title, color }) => (
  <div className="flex items-center gap-2 text-sm">
    <i className={`fas fa-check text-${color}-500`}></i>
    <span>{title}</span>
  </div>
)

export default Dashboard
