'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { botsApi } from '@/lib/api';
import {
  getBotTypeBgColor,
  getBotTypeLabel,
  formatDateTime,
} from '@/lib/utils';
import { StatusBadge } from '@/components/ui/status-badge';
import type { BotConfigResponse } from '@/types';

export function RecentBots() {
  const { data: bots = [], isLoading } = useQuery<BotConfigResponse[]>({
    queryKey: ['bots'],
    queryFn: () => botsApi.getAll().then((r) => r.data),
  });

  // Sort by updatedAt desc, show latest 5
  const recent = [...bots]
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, 5);

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h3 className="text-sm font-semibold text-gray-900">Recent Bots</h3>
        <Link
          href="/dashboard/bots"
          className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          View all <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3 p-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-lg bg-gray-100"
            />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">
          No bots registered yet.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {recent.map((bot) => (
            <li key={bot.botId}>
              <Link
                href={`/dashboard/bots/${bot.botId}`}
                className="flex items-center justify-between px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 font-bold text-sm uppercase">
                    {bot.botId.slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {bot.botName}
                    </p>
                    <p className="text-xs text-gray-400">
                      Updated {formatDateTime(bot.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${getBotTypeBgColor(bot.botType)}`}
                  >
                    {getBotTypeLabel(bot.botType)}
                  </span>
                  <StatusBadge enabled={bot.enabled} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
