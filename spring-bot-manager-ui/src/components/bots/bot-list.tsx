'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, SlidersHorizontal } from 'lucide-react';
import { botsApi } from '@/lib/api';
import { BotCard } from './bot-card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Bot } from 'lucide-react';
import Link from 'next/link';
import type { BotConfigResponse } from '@/types';
import { cn } from '@/lib/utils';

type FilterStatus = 'all' | 'active' | 'inactive';

export function BotList() {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const { data: bots = [], isLoading, error } = useQuery<BotConfigResponse[]>({
    queryKey: ['bots'],
    queryFn: () => botsApi.getAll().then((r) => r.data),
  });

  // Derive unique bot types for the filter
  const botTypes = ['all', ...Array.from(new Set(bots.map((b) => b.botType)))];

  // Apply filters
  const filtered = bots.filter((bot) => {
    const matchesSearch =
      search === '' ||
      bot.botId.toLowerCase().includes(search.toLowerCase()) ||
      bot.botName.toLowerCase().includes(search.toLowerCase()) ||
      bot.phoneNumberId.toLowerCase().includes(search.toLowerCase());

    const matchesType = filterType === 'all' || bot.botType === filterType;

    const matchesStatus =
      filterStatus === 'all' ||
      (filterStatus === 'active' && bot.enabled) ||
      (filterStatus === 'inactive' && !bot.enabled);

    return matchesSearch && matchesType && matchesStatus;
  });

  if (isLoading) {
    return <LoadingSpinner label="Loading bots…" />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Failed to load bots. Please check your connection and try again.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search bots…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        {/* Type + Status filters */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-gray-400" />

          {/* Type filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {botTypes.map((t) => (
              <option key={t} value={t}>
                {t === 'all' ? 'All Types' : t}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-gray-400">
        Showing {filtered.length} of {bots.length} bot
        {bots.length !== 1 ? 's' : ''}
      </p>

      {/* Bot cards grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No bots found"
          description={
            bots.length === 0
              ? 'Get started by creating your first bot.'
              : 'Try adjusting your search or filters.'
          }
          action={
            bots.length === 0 ? (
              <Link
                href="/dashboard/bots/new"
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2',
                  'text-sm font-semibold text-white hover:bg-brand-700 transition-colors'
                )}
              >
                Create your first bot
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((bot) => (
            <BotCard key={bot.botId} bot={bot} />
          ))}
        </div>
      )}
    </div>
  );
}
