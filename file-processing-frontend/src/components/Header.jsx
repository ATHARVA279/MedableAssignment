import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'

const Header = () => {
  const { user, login, logout } = useAuth()
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginForm, setLoginForm] = useState({
    userId: 'test-user',
    role: 'user'
  })

  const handleLogin = async (e) => {
    e.preventDefault()
    const success = await login(loginForm.userId, loginForm.role)
    if (success) {
      setShowLoginModal(false)
      setLoginForm({ userId: 'test-user', role: 'user' })
    }
  }

  return (
    <>
      {/* Header */}
      <header className="header">
        <div className="header-container">
          <div className="header-left">
            <div className="header-title">
              <h1>File Processing API</h1>
              <p>Enterprise File Management System</p>
            </div>
          </div>

          <div className="header-right">
            {user ? (
              <div className="user-info">
                <div className="user-text">
                  <div className="username">{user.userId}</div>
                  <div className="user-role">
                    {user.role === 'admin' ? (
                      <span className="role-badge admin">
                        <i className="fas fa-shield-alt"></i> Administrator
                      </span>
                    ) : (
                      <span className="role-badge user">
                        <i className="fas fa-user"></i> User
                      </span>
                    )}
                  </div>
                </div>
                <button className="btn logout-btn" onClick={logout}>
                  <i className="fas fa-sign-out-alt"></i> Logout
                </button>
              </div>
            ) : (
              <button
                className="btn login-btn"
                onClick={() => setShowLoginModal(true)}
              >
                <i className="fas fa-sign-in-alt"></i> Login
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>
                <i className="fas fa-sign-in-alt"></i> Login to System
              </h2>
              <button className="close-btn" onClick={() => setShowLoginModal(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <div className="form-group">
                <label>
                  <i className="fas fa-user"></i> User ID
                </label>
                <input
                  type="text"
                  value={loginForm.userId}
                  onChange={(e) =>
                    setLoginForm((prev) => ({ ...prev, userId: e.target.value }))
                  }
                  placeholder="Enter your user ID"
                  required
                />
                <p className="form-note">
                  Use 'test-user' for demo or any custom ID
                </p>
              </div>

              <div className="form-group">
                <label>
                  <i className="fas fa-user-tag"></i> Role
                </label>
                <select
                  value={loginForm.role}
                  onChange={(e) =>
                    setLoginForm((prev) => ({ ...prev, role: e.target.value }))
                  }
                  required
                >
                  <option value="user">User</option>
                  <option value="admin">Administrator</option>
                </select>
                <p className="form-note">
                  Admin role provides access to system management features
                </p>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn cancel-btn"
                  onClick={() => setShowLoginModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn submit-btn">
                  <i className="fas fa-sign-in-alt"></i> Login
                </button>
              </div>
            </form>

            <div className="quick-login">
              <h4>Quick Login Options:</h4>
              <div className="quick-buttons">
                <button
                  onClick={() =>
                    setLoginForm({ userId: 'test-user', role: 'user' })
                  }
                  className="btn demo-user-btn"
                >
                  Demo User
                </button>
                <button
                  onClick={() => setLoginForm({ userId: 'admin', role: 'admin' })}
                  className="btn demo-admin-btn"
                >
                  Demo Admin
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default Header
