// ===========================================
// Auth Types
// ===========================================

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  token: string;
  tokenType: string;
  expiresIn: number;
  scopes: string[];
}

// ===========================================
// Bot Types
// ===========================================

export type BotType = 'laundry' | 'thomas_network' | 'pharmacy' | string;

export const BOT_TYPES: { value: BotType; label: string }[] = [
  { value: 'laundry', label: 'Laundry' },
  { value: 'thomas_network', label: 'Thomas Network' },
  { value: 'pharmacy', label: 'Pharmacy' },
];

export interface BotConfigResponse {
  botId: string;
  botName: string;
  botType: BotType;
  phoneNumberId: string;
  hasVerifyToken: boolean;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  config: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotConfigRequest {
  botId: string;
  botName?: string;
  botType: BotType;
  phoneNumberId: string;
  verifyToken?: string;
  accessToken?: string;
  appSecret?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface BotUpdateRequest {
  botName?: string;
  botType?: BotType;
  phoneNumberId?: string;
  verifyToken?: string;
  accessToken?: string;
  appSecret?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface RefreshResponse {
  botsLoaded: number;
  message: string;
}

// ===========================================
// Dashboard Types
// ===========================================

export interface BotStats {
  total: number;
  active: number;
  inactive: number;
  byType: Record<string, number>;
}

// ===========================================
// API Response Types
// ===========================================

export interface ApiError {
  error: string;
  detail?: string;
}

export interface ApiErrorResponse {
  message: string;
  status?: number;
}
