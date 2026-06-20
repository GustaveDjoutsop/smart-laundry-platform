'use client';

import { useAuth } from '@/lib/auth';

interface PermissionGuardProps {
  children: React.ReactNode;
  permission: string;
  fallback?: React.ReactNode;
}

/**
 * Component to conditionally render content based on user permission
 * Use this to show/hide UI elements based on specific permissions
 */
export default function PermissionGuard({ children, permission, fallback = null }: PermissionGuardProps) {
  const { isAuthenticated, checkPermission } = useAuth();

  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  if (!checkPermission(permission)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
