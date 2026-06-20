'use client';

import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
} from 'react';
import { Auth0Provider, useUser } from '@auth0/nextjs-auth0/client';
import type { User } from './types';
import { UserRole } from './types';
import { hasPermission, hasAnyRole } from './utils';

const ROLE_CLAIM = 'https://smartlaundry.api/roles';

interface AuthContextType {
  user: User | null;
  /** Always null — token lives in httpOnly cookie; use the BFF interceptor. */
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  checkPermission: (permission: string) => boolean;
  checkRole: (roles: UserRole[]) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapAuth0User(raw: Record<string, unknown>): User {
  const rawRoles = raw[ROLE_CLAIM];
  const roles: string[] = Array.isArray(rawRoles) ? rawRoles : [];
  const roleStr = roles[0] ?? '';
  const role = (Object.values(UserRole) as string[]).includes(roleStr)
    ? (roleStr as UserRole)
    : UserRole.EMPLOYEE;

  return {
    id: String(raw.sub ?? ''),
    email: String(raw.email ?? ''),
    name: String(raw.name ?? raw.email ?? ''),
    role,
    isActive: true,
    createdAt: new Date(),
  };
}

function AuthInner({ children }: { children: React.ReactNode }) {
  const { user: auth0User, isLoading } = useUser();

  const user = useMemo(
    () =>
      auth0User ? mapAuth0User(auth0User as Record<string, unknown>) : null,
    [auth0User],
  );

  const login = useCallback(() => {
    window.location.href = '/auth/login';
  }, []);

  const logout = useCallback(async () => {
    window.location.href = '/auth/logout';
  }, []);

  const logoutAll = useCallback(async () => {
    window.location.href = '/auth/logout';
  }, []);

  const checkPermission = useCallback(
    (permission: string) => hasPermission(user, permission),
    [user],
  );

  const checkRole = useCallback(
    (roles: UserRole[]) => hasAnyRole(user, roles),
    [user],
  );

  const refreshUser = useCallback(async () => {
    // Auth0Provider re-fetches /auth/profile on demand; session refresh
    // is handled automatically by the middleware rolling window.
  }, []);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      token: null,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
      logoutAll,
      checkPermission,
      checkRole,
      refreshUser,
    }),
    [
      user,
      isLoading,
      login,
      logout,
      logoutAll,
      checkPermission,
      checkRole,
      refreshUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider>
      <AuthInner>{children}</AuthInner>
    </Auth0Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function withAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  requiredRoles?: UserRole[],
  requiredPermission?: string,
) {
  return function AuthenticatedComponent(props: P) {
    const { isAuthenticated, isLoading, checkRole, checkPermission } = useAuth();

    if (isLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
        </div>
      );
    }

    if (!isAuthenticated) {
      return null;
    }

    if (requiredRoles && !checkRole(requiredRoles)) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
            <p className="mt-2 text-gray-600">
              You don&apos;t have permission to access this page.
            </p>
          </div>
        </div>
      );
    }

    if (requiredPermission && !checkPermission(requiredPermission)) {
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
            <p className="mt-2 text-gray-600">
              You don&apos;t have permission to access this page.
            </p>
          </div>
        </div>
      );
    }

    return <WrappedComponent {...props} />;
  };
}
