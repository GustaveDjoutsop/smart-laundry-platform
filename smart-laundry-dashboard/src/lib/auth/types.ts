// User roles with hierarchical levels
export enum UserRole {
  ADMIN = 'admin',           // Super user - Full system access (level 100)
  OWNER = 'owner',           // Business owner - Strategic decisions (level 80)
  MANAGER = 'manager',       // Operations manager (level 60)
  ACCOUNTANT = 'accountant', // Financial read-only access (level 40)
  EMPLOYEE = 'employee',     // Basic operational access (level 20)
}

// Role hierarchy levels for comparisons
export const RoleHierarchy: Record<UserRole, number> = {
  [UserRole.ADMIN]: 100,
  [UserRole.OWNER]: 80,
  [UserRole.MANAGER]: 60,
  [UserRole.ACCOUNTANT]: 40,
  [UserRole.EMPLOYEE]: 20,
};

// User interface
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  lastLogin?: Date;
}

// Auth state with refresh token support
export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  tokenExpiresAt: number | null; // Unix timestamp in milliseconds
}

// Login credentials
export interface LoginCredentials {
  email: string;
  password: string;
}

// Auth response from backend (updated for new token flow)
export interface AuthResponse {
  success: boolean;
  token: string;
  refreshToken: string;
  expiresIn: number; // seconds until token expires
  mustChangePassword: boolean; // true if user must change password on first login
  user: User;
}

// Refresh token response
export interface RefreshResponse {
  success: boolean;
  token: string;
  expiresIn: number;
}

// Permission definitions for each role
export const RolePermissions: Record<UserRole, string[]> = {
  [UserRole.ADMIN]: [
    // All permissions
    'users:create', 'users:read', 'users:update', 'users:delete', 'users:assign-role',
    'machines:read', 'machines:control', 'machines:config', 'machines:maintenance',
    'transactions:read', 'transactions:export', 'transactions:refund',
    'finance:dashboard', 'finance:reports', 'finance:export', 'finance:settings',
    'system:settings', 'system:logs', 'system:backup',
    // Timekeeping and absences permissions
    'timekeeping:clock', 'timekeeping:view_own', 'timekeeping:view_all', 'timekeeping:manage',
    'absences:create_own', 'absences:view_all', 'absences:approve',
    // Legacy permissions for backward compatibility
    'dashboard:view', 'revenue:view', 'reports:view', 'reports:export',
    'expenses:view', 'expenses:create', 'expenses:edit', 'settings:view', 'settings:edit',
    'reconciliation:run', 'cafe:view', 'cafe:manage',
  ],
  [UserRole.OWNER]: [
    'users:create', 'users:read', 'users:update', 'users:assign-role',
    'machines:read', 'machines:control', 'machines:config', 'machines:maintenance',
    'transactions:read', 'transactions:export', 'transactions:refund',
    'finance:dashboard', 'finance:reports', 'finance:export', 'finance:settings',
    'system:settings',
    // Timekeeping and absences permissions
    'timekeeping:clock', 'timekeeping:view_own', 'timekeeping:view_all', 'timekeeping:manage',
    'absences:create_own', 'absences:view_all', 'absences:approve',
    // Legacy permissions
    'dashboard:view', 'revenue:view', 'reports:view', 'reports:export',
    'expenses:view', 'expenses:create', 'expenses:edit', 'settings:view', 'settings:edit',
    'reconciliation:run', 'cafe:view', 'cafe:manage',
  ],
  [UserRole.MANAGER]: [
    'users:read',
    'machines:read', 'machines:control', 'machines:maintenance',
    'transactions:read', 'transactions:export',
    'finance:dashboard', 'finance:reports',
    // Timekeeping and absences permissions
    'timekeeping:clock', 'timekeeping:view_own', 'timekeeping:view_all', 'timekeeping:manage',
    'absences:create_own', 'absences:view_all', 'absences:approve',
    // Legacy permissions
    'dashboard:view', 'revenue:view', 'reports:view', 'reports:export',
    'expenses:view', 'expenses:create', 'reconciliation:run', 'cafe:view', 'cafe:manage',
  ],
  [UserRole.ACCOUNTANT]: [
    'machines:read',
    'transactions:read', 'transactions:export',
    'finance:dashboard', 'finance:reports', 'finance:export',
    // Timekeeping and absences permissions
    'timekeeping:clock', 'timekeeping:view_own',
    'absences:create_own', 'absences:view_all',
    // Legacy permissions
    'dashboard:view', 'revenue:view', 'reports:view', 'reports:export', 'expenses:view',
  ],
  [UserRole.EMPLOYEE]: [
    'machines:read', 'machines:control',
    'transactions:read',
    // Timekeeping and absences permissions
    'timekeeping:clock', 'timekeeping:view_own',
    'absences:create_own', 'absences:view_all',
    // Legacy permissions
    'dashboard:view',
  ],
};

// Which roles can create which other roles
export const RoleCreationPermissions: Record<UserRole, UserRole[]> = {
  [UserRole.ADMIN]: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.EMPLOYEE],
  [UserRole.OWNER]: [UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.EMPLOYEE],
  [UserRole.MANAGER]: [],
  [UserRole.ACCOUNTANT]: [],
  [UserRole.EMPLOYEE]: [],
};

// Route access configuration
export interface RouteAccess {
  path: string;
  allowedRoles: UserRole[];
  requiredPermission?: string;
}

// Protected routes configuration
export const ProtectedRoutes: RouteAccess[] = [
  { path: '/dashboard', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.EMPLOYEE] },
  { path: '/dashboard/machines', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.EMPLOYEE] },
  { path: '/dashboard/transactions', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.EMPLOYEE] },
  { path: '/dashboard/revenue', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT] },
  { path: '/dashboard/expenses', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT] },
  { path: '/dashboard/maintenance', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER] },
  { path: '/dashboard/reports', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT] },
  { path: '/dashboard/feedback', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT] },
  { path: '/dashboard/users', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER] },
  { path: '/dashboard/timekeeping', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.EMPLOYEE] },
  { path: '/dashboard/absences', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER, UserRole.ACCOUNTANT, UserRole.EMPLOYEE] },
  { path: '/dashboard/settings', allowedRoles: [UserRole.ADMIN, UserRole.OWNER] },
  { path: '/dashboard/cafe', allowedRoles: [UserRole.ADMIN, UserRole.OWNER, UserRole.MANAGER] },
];

// Session info for multi-device management
export interface SessionInfo {
  index: number;
  deviceInfo: string;
  ipAddress?: string;
  createdAt: Date;
  lastUsed: Date;
}

// Login history entry
export interface LoginHistoryEntry {
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  success: boolean;
}
