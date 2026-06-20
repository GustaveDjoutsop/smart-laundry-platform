'use client';

import { usePathname, useRouter } from 'next/navigation';
import { LogOut, RefreshCw, User } from 'lucide-react';
import { useState } from 'react';
import { botsApi } from '@/lib/api';
import { cn } from '@/lib/utils';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Overview',
  '/dashboard/bots': 'All Bots',
  '/dashboard/bots/new': 'Create Bot',
  '/dashboard/settings': 'Settings',
  '/dashboard/help': 'Help',
};

function getTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.endsWith('/edit')) return 'Edit Bot';
  if (pathname.includes('/dashboard/bots/')) return 'Bot Details';
  return 'Spring Bot Manager';
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  async function handleRefresh() {
    setIsRefreshing(true);
    setRefreshMsg(null);
    try {
      const { data } = await botsApi.refresh();
      setRefreshMsg(`${data.botsLoaded} bot(s) reloaded`);
      setTimeout(() => setRefreshMsg(null), 3000);
    } catch {
      setRefreshMsg('Refresh failed');
      setTimeout(() => setRefreshMsg(null), 3000);
    } finally {
      setIsRefreshing(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('token');
    router.push('/login');
  }

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      {/* Page title */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          {getTitle(pathname)}
        </h2>
      </div>

      {/* Right side actions */}
      <div className="flex items-center gap-3">
        {/* Refresh toast feedback */}
        {refreshMsg && (
          <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
            {refreshMsg}
          </span>
        )}

        {/* Refresh registry button */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          title="Refresh bot registry"
          className={cn(
            'flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5',
            'text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900',
            'disabled:cursor-not-allowed disabled:opacity-60 transition-colors'
          )}
        >
          <RefreshCw
            className={cn('h-4 w-4', isRefreshing && 'animate-spin')}
          />
          <span className="hidden sm:inline">Refresh Registry</span>
        </button>

        {/* User / Logout */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100">
            <User className="h-4 w-4 text-brand-700" />
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
