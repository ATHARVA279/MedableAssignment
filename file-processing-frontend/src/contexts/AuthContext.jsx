import React, { createContext, useContext, useState, useEffect } from 'react'
import { authService } from '../services/authService'
import toast from 'react-hot-toast'

const AuthContext = createContext()

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuthStatus()
  }, [])

  const checkAuthStatus = async () => {
    try {
      const token = localStorage.getItem('authToken')
      if (token) {
        authService.setToken(token)
        const userData = await authService.getCurrentUser()
        setUser(userData.user)
      }
    } catch (error) {
      console.error('Auth check failed:', error)
      localStorage.removeItem('authToken')
      authService.clearToken()
    } finally {
      setLoading(false)
    }
  }

  const login = async (userId, role) => {
    try {
      setLoading(true)
      const response = await authService.generateTestToken(userId, role)

      if (response.token) {
        localStorage.setItem('authToken', response.token)
        authService.setToken(response.token)
        setUser(response.user)
        toast.success(`Welcome ${response.user.userId}!`)
        return true
      }
    } catch (error) {
      toast.error(`Login failed: ${error.message}`)
      return false
    } finally {
      setLoading(false)
    }
  }

  const logout = () => {
    localStorage.removeItem('authToken')
    authService.clearToken()
    setUser(null)
    toast.success('Logged out successfully')
  }

  const value = {
    user,
    loading,
    login,
    logout,
    checkAuthStatus
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}