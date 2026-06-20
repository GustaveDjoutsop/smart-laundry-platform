// Types
export { UserRole } from './types';
export type {
  User,
  AuthState,
  LoginCredentials,
  AuthResponse,
  RouteAccess,
} from './types';
export { RolePermissions, ProtectedRoutes, RoleHierarchy, RoleCreationPermissions } from './types';

// Utilities
export {
  tokenUtils,
  userUtils,
  refreshTokenUtils,
  tokenExpiryUtils,
  clearAuthData,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  hasRole,
  hasAnyRole,
  canAccessRoute,
  getAccessibleRoutes,
  isRoleAtLeast,
  getRoleDisplayName,
  getRoleBadgeColor,
  canCreateRole,
  getCreatableRoles,
} from './utils';

// Context and hooks
export { AuthProvider, useAuth, withAuth } from './context';
