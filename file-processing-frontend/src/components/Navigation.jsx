import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const Navigation = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()

  const navigationItems = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fas fa-tachometer-alt', path: '/dashboard', requireAuth: false },
    { id: 'upload', label: 'Upload Files', icon: 'fas fa-cloud-upload-alt', path: '/upload', requireAuth: true },
    { id: 'files', label: 'File Manager', icon: 'fas fa-folder-open', path: '/files', requireAuth: true },
    { id: 'sharing', label: 'File Sharing', icon: 'fas fa-share-alt', path: '/sharing', requireAuth: true },
    { id: 'quotas', label: 'Storage Quotas', icon: 'fas fa-chart-pie', path: '/quotas', requireAuth: true },

  ]

  if (user?.role === 'admin') {
    navigationItems.push({
      id: 'admin', label: 'Admin Panel', icon: 'fas fa-shield-alt', path: '/admin', requireAuth: true, adminOnly: true
    })
  }

  const handleNavigation = (item) => {
    if (item.requireAuth && !user) return
    navigate(item.path)
  }

  return (
    <nav className="navigation-bar">
      <div className="navigation-container">
        {navigationItems.map((item) => {
          const isActive = location.pathname === item.path
          const isDisabled = item.requireAuth && !user
          return (
            <button
              key={item.id}
              onClick={() => handleNavigation(item)}
              disabled={isDisabled}
              className={`nav-item ${isActive ? 'active' : ''} ${isDisabled ? 'disabled' : ''} ${item.adminOnly ? 'admin' : ''}`}
            >
              <i className={item.icon}></i>
              <span>{item.label}</span>
              {item.adminOnly && <span className="admin-badge">ADMIN</span>}
              {isDisabled && <i className="fas fa-lock lock-icon"></i>}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export default Navigation
