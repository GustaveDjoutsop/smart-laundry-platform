'use client';

import { useAuth, UserRole } from '@/lib/auth';

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles: UserRole[];
  fallback?: React.ReactNode;
}

/**
 * Component to conditionally render content based on user role
 * Use this to show/hide UI elements based on permissions
 */
export default function RoleGuard({ children, allowedRoles, fallback = null }: RoleGuardProps) {
  const { user, isAuthenticated, checkRole } = useAuth();

  if (!isAuthenticated || !user) {
    return <>{fallback}</>;
  }

  if (!checkRole(allowedRoles)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
