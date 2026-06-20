'use client';

import { useEffect, useState } from 'react';
import { WashingMachine, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [redirecting, setRedirecting] = useState(false);

  // If already authenticated, go to dashboard
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      window.location.href = '/dashboard';
    }
  }, [isAuthenticated, isLoading]);

  const handleLogin = () => {
    setRedirecting(true);
    window.location.href = '/auth/login';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-primary-100 px-4">
      <div className="max-w-md w-full">
        {/* Logo and Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-600 mb-4">
            <WashingMachine className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Smart Laundry Dashboard</h1>
          <p className="mt-2 text-sm text-gray-600">Sign in to manage your laundromat</p>
        </div>

        {/* Sign-in Card */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <button
            onClick={handleLogin}
            disabled={redirecting}
            className="w-full flex items-center justify-center px-4 py-2.5 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {redirecting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Redirecting to login...
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </div>

        <p className="mt-6 text-center text-sm text-gray-500">
          Need help?{' '}
          <a
            href="mailto:sundaygustav@gmail.com"
            className="font-medium text-primary-600 hover:text-primary-500"
          >
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}
