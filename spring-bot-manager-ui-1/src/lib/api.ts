import axios from 'axios';
import type {
  BotConfigRequest,
  BotConfigResponse,
  BotUpdateRequest,
  LoginRequest,
  RefreshResponse,
  TokenResponse,
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8090';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor – attach JWT token from localStorage
apiClient.interceptors.request.use(
  (config) => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor – redirect to login on 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ===========================================
// Auth API
// ===========================================

export const authApi = {
  login: (data: LoginRequest) =>
    apiClient.post<TokenResponse>('/auth/login', data),
};

// ===========================================
// Bots Admin API  (/admin/bots)
// ===========================================

export const botsApi = {
  /** List all bots */
  getAll: () => apiClient.get<BotConfigResponse[]>('/admin/bots'),

  /** Get a single bot by botId */
  getOne: (botId: string) =>
    apiClient.get<BotConfigResponse>(`/admin/bots/${botId}`),

  /** Create a new bot */
  create: (data: BotConfigRequest) =>
    apiClient.post<BotConfigResponse>('/admin/bots', data),

  /** Update an existing bot */
  update: (botId: string, data: BotUpdateRequest) =>
    apiClient.put<BotConfigResponse>(`/admin/bots/${botId}`, data),

  /** Disable a bot */
  disable: (botId: string) =>
    apiClient.put<{ message: string }>(`/admin/bots/${botId}/disable`),

  /** Re-enable a bot (via update) */
  enable: (botId: string) =>
    apiClient.put<BotConfigResponse>(`/admin/bots/${botId}`, {
      enabled: true,
    }),

  /** Publish a registry refresh event */
  refresh: () => apiClient.post<RefreshResponse>('/admin/bots/refresh'),
};

export default apiClient;
