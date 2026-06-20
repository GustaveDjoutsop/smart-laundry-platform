'use client';

import { useAuth, UserRole } from '@/lib/auth';
import { ShieldAlert, Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRoles?: UserRole[];
  requiredPermission?: string;
  fallback?: React.ReactNode;
}

export default function ProtectedRoute({
  children,
  requiredRoles,
  requiredPermission,
  fallback,
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, checkRole, checkPermission } = useAuth();

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  // Not authenticated - will be handled by middleware/context redirect
  if (!isAuthenticated) {
    return fallback || null;
  }

  // Check role access
  if (requiredRoles && !checkRole(requiredRoles)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <div className="w-16 h-16 rounded-full bg-danger-50 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8 text-danger-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-600 max-w-md">
          You don&apos;t have the required role to access this content.
          Please contact your administrator if you believe this is an error.
        </p>
      </div>
    );
  }

  // Check permission access
  if (requiredPermission && !checkPermission(requiredPermission)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <div className="w-16 h-16 rounded-full bg-danger-50 flex items-center justify-center mb-4">
          <ShieldAlert className="w-8 h-8 text-danger-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Permission Required</h2>
        <p className="text-gray-600 max-w-md">
          You don&apos;t have permission to access this content.
          Please contact your administrator for access.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
