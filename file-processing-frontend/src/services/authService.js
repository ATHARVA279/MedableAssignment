import { apiClient } from "./apiClient";

class AuthService {
  constructor() {
    this.token = localStorage.getItem("authToken");
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem("authToken", token);
    apiClient.setAuthToken(token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem("authToken");
    apiClient.clearAuthToken();
  }

  async login(userId = "test-user", role = "user") {
    try {
      const response = await apiClient.post("/api/auth/login", {
        userId,
        role,
      });

      const { token, user } = response.data;
      this.setToken(token);

      return { token, user };
    } catch (error) {
      throw new Error(error.response?.data?.error || "Login failed");
    }
  }

  async generateTestToken(userId = "test-user", role = "user") {
    try {
      const response = await apiClient.post("/api/auth/test-token", {
        userId,
        role,
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || "Authentication failed");
    }
  }

  async getCurrentUser() {
    try {
      const response = await apiClient.get("/api/auth/me");
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || "Failed to get user info");
    }
  }

  async checkAuthStatus() {
    if (!this.token) return null;

    try {
      const userData = await this.getCurrentUser();
      return userData.user;
    } catch (error) {
      this.clearToken();
      return null;
    }
  }

  isAuthenticated() {
    return !!this.token;
  }

  getToken() {
    return this.token;
  }
}

export const authService = new AuthService();
