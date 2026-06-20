'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, CheckCircle2, XCircle, LayoutGrid } from 'lucide-react';
import { botsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { BotConfigResponse } from '@/types';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  iconBg: string;
  description?: string;
}

function StatCard({ title, value, icon, iconBg, description }: StatCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
          {description && (
            <p className="mt-1 text-xs text-gray-400">{description}</p>
          )}
        </div>
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-lg',
            iconBg
          )}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

export function OverviewCards() {
  const { data: bots = [], isLoading } = useQuery<BotConfigResponse[]>({
    queryKey: ['bots'],
    queryFn: () => botsApi.getAll().then((r) => r.data),
  });

  const total = bots.length;
  const active = bots.filter((b) => b.enabled).length;
  const inactive = total - active;

  const byType = bots.reduce<Record<string, number>>((acc, bot) => {
    acc[bot.botType] = (acc[bot.botType] ?? 0) + 1;
    return acc;
  }, {});

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border border-gray-200 bg-white"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total Bots"
        value={total}
        icon={<Bot className="h-5 w-5 text-brand-600" />}
        iconBg="bg-brand-50"
        description="registered in the system"
      />
      <StatCard
        title="Active Bots"
        value={active}
        icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
        iconBg="bg-green-50"
        description="currently enabled"
      />
      <StatCard
        title="Inactive Bots"
        value={inactive}
        icon={<XCircle className="h-5 w-5 text-gray-400" />}
        iconBg="bg-gray-50"
        description="disabled or pending"
      />
      <StatCard
        title="Bot Types"
        value={Object.keys(byType).length}
        icon={<LayoutGrid className="h-5 w-5 text-violet-600" />}
        iconBg="bg-violet-50"
        description={
          Object.entries(byType)
            .map(([t, n]) => `${t}: ${n}`)
            .join(' · ') || 'none yet'
        }
      />
    </div>
  );
}
