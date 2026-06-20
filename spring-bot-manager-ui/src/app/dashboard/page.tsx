import { Suspense } from 'react';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import { OverviewCards } from '@/components/dashboard/overview-cards';
import { RecentBots } from '@/components/dashboard/recent-bots';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Welcome back, Admin
          </h2>
          <p className="text-sm text-gray-500">
            Here&apos;s what&apos;s happening with your bots today.
          </p>
        </div>
        <Link
          href="/dashboard/bots/new"
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <PlusCircle className="h-4 w-4" />
          New Bot
        </Link>
      </div>

      {/* Stats cards */}
      <Suspense fallback={<LoadingSpinner label="Loading stats…" />}>
        <OverviewCards />
      </Suspense>

      {/* Recent bots table */}
      <Suspense fallback={<LoadingSpinner label="Loading bots…" />}>
        <RecentBots />
      </Suspense>
    </div>
  );
}
