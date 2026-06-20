import { UserRole, RolePermissions, ProtectedRoutes, User, RoleHierarchy, RoleCreationPermissions } from './types';

// Storage keys
const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const USER_KEY = 'auth_user';
const TOKEN_EXPIRES_KEY = 'auth_token_expires';

// Cookie helper functions
const setCookie = (name: string, value: string, days: number = 7): void => {
  if (typeof document === 'undefined') return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
};

const removeCookie = (name: string): void => {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
};

// Token management
export const tokenUtils = {
  get: (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  set: (token: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOKEN_KEY, token);
    // Also set as cookie for middleware SSR access
    setCookie(TOKEN_KEY, token);
  },

  remove: (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
    removeCookie(TOKEN_KEY);
  },

  // Decode JWT token (without verification - verification happens on backend)
  decode: (token: string): { exp: number; userId: string; role: UserRole; iat: number } | null => {
    try {
      const base64Payload = token.split('.')[1];
      const payload = JSON.parse(atob(base64Payload));
      return payload;
    } catch {
      return null;
    }
  },

  isExpired: (token: string): boolean => {
    const decoded = tokenUtils.decode(token);
    if (!decoded) return true;
    return Date.now() >= decoded.exp * 1000;
  },

  // Get time until token expires in milliseconds
  getTimeUntilExpiry: (token: string): number => {
    const decoded = tokenUtils.decode(token);
    if (!decoded) return 0;
    return Math.max(0, decoded.exp * 1000 - Date.now());
  },
};

// Refresh token management
export const refreshTokenUtils = {
  get: (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  },

  set: (token: string): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  },

  remove: (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// Token expiry management
export const tokenExpiryUtils = {
  get: (): number | null => {
    if (typeof window === 'undefined') return null;
    const expires = localStorage.getItem(TOKEN_EXPIRES_KEY);
    return expires ? parseInt(expires, 10) : null;
  },

  set: (expiresAt: number): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOKEN_EXPIRES_KEY, expiresAt.toString());
  },

  remove: (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_EXPIRES_KEY);
  },
};

// User storage management
export const userUtils = {
  get: (): User | null => {
    if (typeof window === 'undefined') return null;
    const userStr = localStorage.getItem(USER_KEY);
    if (!userStr) return null;
    try {
      return JSON.parse(userStr);
    } catch {
      return null;
    }
  },

  set: (user: User): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  remove: (): void => {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(USER_KEY);
  },
};

// Clear all auth data
export const clearAuthData = (): void => {
  tokenUtils.remove();
  refreshTokenUtils.remove();
  tokenExpiryUtils.remove();
  userUtils.remove();
};

// Permission checking
export const hasPermission = (user: User | null, permission: string): boolean => {
  if (!user) return false;
  const permissions = RolePermissions[user.role];
  return permissions?.includes(permission) ?? false;
};

// Check if user has any of the specified permissions
export const hasAnyPermission = (user: User | null, permissions: string[]): boolean => {
  if (!user) return false;
  return permissions.some(permission => hasPermission(user, permission));
};

// Check if user has all of the specified permissions
export const hasAllPermissions = (user: User | null, permissions: string[]): boolean => {
  if (!user) return false;
  return permissions.every(permission => hasPermission(user, permission));
};

// Role checking
export const hasRole = (user: User | null, role: UserRole): boolean => {
  if (!user) return false;
  return user.role === role;
};

// Check if user has any of the specified roles
export const hasAnyRole = (user: User | null, roles: UserRole[]): boolean => {
  if (!user) return false;
  return roles.includes(user.role);
};

// Check if user can access a specific route
export const canAccessRoute = (user: User | null, path: string): boolean => {
  if (!user) return false;

  // Find matching route configuration
  const routeConfig = ProtectedRoutes.find(route => {
    // Exact match or path starts with route path
    return path === route.path || path.startsWith(route.path + '/');
  });

  // If no specific config, default to requiring authentication only
  if (!routeConfig) return true;

  // Check if user role is allowed
  return routeConfig.allowedRoles.includes(user.role);
};

// Get accessible routes for a user
export const getAccessibleRoutes = (user: User | null): string[] => {
  if (!user) return [];
  return ProtectedRoutes
    .filter(route => route.allowedRoles.includes(user.role))
    .map(route => route.path);
};

// Get role level from hierarchy
export const getRoleLevel = (role: UserRole): number => {
  return RoleHierarchy[role] || 0;
};

// Check if user role is at least the specified level
export const isRoleAtLeast = (user: User | null, minRole: UserRole): boolean => {
  if (!user) return false;
  return getRoleLevel(user.role) >= getRoleLevel(minRole);
};

// Check if user role is higher than another role
export const isRoleHigherThan = (role1: UserRole, role2: UserRole): boolean => {
  return getRoleLevel(role1) > getRoleLevel(role2);
};

// Check if user can create a specific role
export const canCreateRole = (creatorRole: UserRole, targetRole: UserRole): boolean => {
  const allowedRoles = RoleCreationPermissions[creatorRole] || [];
  return allowedRoles.includes(targetRole);
};

// Get roles that a user can create
export const getCreatableRoles = (role: UserRole): UserRole[] => {
  return RoleCreationPermissions[role] || [];
};

// Get role display name
export const getRoleDisplayName = (role: UserRole): string => {
  const displayNames: Record<UserRole, string> = {
    [UserRole.ADMIN]: 'Administrator',
    [UserRole.OWNER]: 'Owner',
    [UserRole.MANAGER]: 'Manager',
    [UserRole.ACCOUNTANT]: 'Accountant',
    [UserRole.EMPLOYEE]: 'Employee',
  };
  return displayNames[role] || role;
};

// Get role badge color
export const getRoleBadgeColor = (role: UserRole): string => {
  const colors: Record<UserRole, string> = {
    [UserRole.ADMIN]: 'bg-red-100 text-red-700',
    [UserRole.OWNER]: 'bg-purple-100 text-purple-700',
    [UserRole.MANAGER]: 'bg-blue-100 text-blue-700',
    [UserRole.ACCOUNTANT]: 'bg-yellow-100 text-yellow-700',
    [UserRole.EMPLOYEE]: 'bg-green-100 text-green-700',
  };
  return colors[role] || 'bg-gray-100 text-gray-700';
};

// Get all valid roles
export const getAllRoles = (): UserRole[] => {
  return Object.values(UserRole);
};

// Get roles sorted by hierarchy (lowest to highest)
export const getRolesByHierarchy = (): UserRole[] => {
  return getAllRoles().sort((a, b) => getRoleLevel(a) - getRoleLevel(b));
};
