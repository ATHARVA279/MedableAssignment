import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import toast from 'react-hot-toast'

import Header from './components/Header'
import Navigation from './components/Navigation'
import Dashboard from './pages/Dashboard'
import FileUpload from './pages/FileUpload'
import FileManager from './pages/FileManager'
import FileVersions from './pages/FileVersions'
import FileSharing from './pages/FileSharing'
import StorageQuotas from './pages/StorageQuotas'
import AdminPanel from './pages/AdminPanel'

import { authService } from './services/authService'
import { AuthProvider, useAuth } from './contexts/AuthContext'

function AppContent() {
  const { user, loading } = useAuth()
  const [activeTab, setActiveTab] = useState('dashboard')

  useEffect(() => {
    authService.checkAuthStatus()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="loading">
          <div className="loading-spinner"></div>
          Loading application...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header />
      <Navigation activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="container py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/upload" element={user ? <FileUpload /> : <Navigate to="/dashboard" />} />
          <Route path="/files" element={user ? <FileManager /> : <Navigate to="/dashboard" />} />
          <Route path="/versions" element={user ? <FileVersions /> : <Navigate to="/dashboard" />} />
          <Route path="/sharing" element={user ? <FileSharing /> : <Navigate to="/dashboard" />} />
          <Route path="/quotas" element={user ? <StorageQuotas /> : <Navigate to="/dashboard" />} />

          <Route
            path="/admin"
            element={
              user?.role === 'admin' ? <AdminPanel /> : <Navigate to="/dashboard" />
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App