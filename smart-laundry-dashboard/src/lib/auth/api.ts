import api from '@/lib/api';
import type { LoginCredentials, AuthResponse, RefreshResponse, User, SessionInfo } from './types';

// Auth API endpoints
export const authApi = {
  /**
   * POST /api/auth/login
   * Authenticate user and get JWT tokens
   */
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/auth/login', credentials);
    return response.data;
  },

  /**
   * POST /api/auth/logout
   * Invalidate current session (single device)
   */
  logout: async (refreshToken?: string): Promise<void> => {
    await api.post('/auth/logout', { refreshToken });
  },

  /**
   * POST /api/auth/logout-all
   * Invalidate all sessions (all devices)
   */
  logoutAll: async (): Promise<void> => {
    await api.post('/auth/logout-all');
  },

  /**
   * GET /api/auth/me
   * Get current user profile
   */
  getProfile: async (): Promise<{ success: boolean; user: User }> => {
    const response = await api.get<{ success: boolean; user: User }>('/auth/me');
    return response.data;
  },

  /**
   * POST /api/auth/refresh
   * Refresh JWT token using refresh token
   */
  refreshToken: async (refreshToken: string): Promise<RefreshResponse> => {
    const response = await api.post<RefreshResponse>('/auth/refresh', { refreshToken });
    return response.data;
  },

  /**
   * POST /api/auth/change-password
   * Change user password (invalidates all sessions)
   */
  changePassword: async (currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
    const response = await api.post<{ success: boolean; message: string }>('/auth/change-password', {
      currentPassword,
      newPassword,
    });
    return response.data;
  },

  /**
   * POST /api/auth/force-change-password
   * Change password on first login (when mustChangePassword is true)
   * Does not require current password
   */
  forceChangePassword: async (newPassword: string): Promise<{ success: boolean; message: string }> => {
    const response = await api.post<{ success: boolean; message: string }>('/auth/force-change-password', {
      newPassword,
    });
    return response.data;
  },

  /**
   * GET /api/auth/sessions
   * Get all active sessions for current user
   */
  getSessions: async (): Promise<{ success: boolean; sessions: SessionInfo[]; count: number }> => {
    const response = await api.get<{ success: boolean; sessions: SessionInfo[]; count: number }>('/auth/sessions');
    return response.data;
  },

  /**
   * DELETE /api/auth/sessions/:index
   * Revoke a specific session
   */
  revokeSession: async (sessionIndex: number): Promise<{ success: boolean; message: string }> => {
    const response = await api.delete<{ success: boolean; message: string }>(`/auth/sessions/${sessionIndex}`);
    return response.data;
  },

  /**
   * POST /api/auth/forgot-password
   * Request password reset
   */
  forgotPassword: async (email: string): Promise<void> => {
    await api.post('/auth/forgot-password', { email });
  },

  /**
   * POST /api/auth/reset-password
   * Reset password with token
   */
  resetPassword: async (token: string, newPassword: string): Promise<void> => {
    await api.post('/auth/reset-password', { token, newPassword });
  },
};
