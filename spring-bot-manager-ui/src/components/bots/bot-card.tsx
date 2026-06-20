'use client';

import Link from 'next/link';
import {
  Phone,
  KeyRound,
  ShieldCheck,
  Fingerprint,
  ArrowRight,
  Settings2,
} from 'lucide-react';
import { cn, getBotTypeBgColor, getBotTypeLabel, formatRelativeTime } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/status-badge';
import type { BotConfigResponse } from '@/types';

interface BotCardProps {
  bot: BotConfigResponse;
}

function CredentialIndicator({
  present,
  label,
  icon: Icon,
}: {
  present: boolean;
  label: string;
  icon: React.ElementType;
}) {
  return (
    <span
      title={present ? `${label} configured` : `${label} not set`}
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        present
          ? 'bg-green-50 text-green-700'
          : 'bg-gray-50 text-gray-400'
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

export function BotCard({ bot }: BotCardProps) {
  return (
    <div className="group rounded-xl border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow">
      {/* Card header */}
      <div className="flex items-start justify-between p-5 pb-3">
        <div className="flex items-center gap-3">
          {/* Bot avatar */}
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700 font-bold text-sm uppercase">
            {bot.botId.slice(0, 2)}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 group-hover:text-brand-700 transition-colors">
              {bot.botName}
            </h3>
            <p className="text-xs text-gray-400 font-mono">{bot.botId}</p>
          </div>
        </div>
        <StatusBadge enabled={bot.enabled} />
      </div>

      {/* Bot type + phone */}
      <div className="flex items-center gap-2 px-5 pb-3">
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-xs font-medium',
            getBotTypeBgColor(bot.botType)
          )}
        >
          {getBotTypeLabel(bot.botType)}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-400">
          <Phone className="h-3 w-3" />
          {bot.phoneNumberId}
        </span>
      </div>

      {/* Credentials */}
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        <CredentialIndicator
          present={bot.hasVerifyToken}
          label="Verify Token"
          icon={Fingerprint}
        />
        <CredentialIndicator
          present={bot.hasAccessToken}
          label="Access Token"
          icon={KeyRound}
        />
        <CredentialIndicator
          present={bot.hasAppSecret}
          label="App Secret"
          icon={ShieldCheck}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
        <p className="text-xs text-gray-400">
          Updated {formatRelativeTime(bot.updatedAt)}
        </p>
        <div className="flex items-center gap-1">
          <Link
            href={`/dashboard/bots/${bot.botId}/edit`}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Edit
          </Link>
          <Link
            href={`/dashboard/bots/${bot.botId}`}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-brand-600 hover:bg-brand-50 transition-colors"
          >
            View <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
