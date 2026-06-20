'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { botsApi } from '@/lib/api';
import { BotForm } from '@/components/bots/bot-form';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import type { BotConfigResponse } from '@/types';

export default function EditBotPage() {
  const { botId } = useParams<{ botId: string }>();

  const { data: bot, isLoading, error } = useQuery<BotConfigResponse>({
    queryKey: ['bot', botId],
    queryFn: () => botsApi.getOne(botId).then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner label="Loading bot…" />;

  if (error || !bot) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Bot not found or failed to load.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back */}
      <Link
        href={`/dashboard/bots/${botId}`}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to bot details
      </Link>

      <div>
        <h2 className="text-xl font-semibold text-gray-900">
          Edit Bot: {bot.botName}
        </h2>
        <p className="text-sm text-gray-500">
          Update credentials, configuration or status for this bot.
        </p>
      </div>

      <BotForm mode="edit" bot={bot} />
    </div>
  );
}
