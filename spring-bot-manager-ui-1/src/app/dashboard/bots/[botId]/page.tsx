'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Settings2,
  Power,
  PowerOff,
  Fingerprint,
  KeyRound,
  ShieldCheck,
  CreditCard,
  Coins,
  Phone,
  CalendarClock,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { botsApi } from '@/lib/api';
import {
  cn,
  getBotTypeBgColor,
  getBotTypeLabel,
  formatDateTime,
  formatRelativeTime,
} from '@/lib/utils';
import { StatusBadge } from '@/components/ui/status-badge';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import type { BotConfigResponse } from '@/types';
import { useState } from 'react';

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between py-3 border-b border-gray-100 last:border-0">
      <dt className="min-w-[160px] text-sm text-gray-500">{label}</dt>
      <dd
        className={cn(
          'text-sm font-medium text-gray-900 sm:text-right',
          mono && 'font-mono text-xs'
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function CredentialRow({
  label,
  present,
  icon: Icon,
}: {
  label: string;
  present: boolean;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="flex items-center gap-2 text-sm text-gray-500">
        <Icon className="h-4 w-4 text-gray-400" />
        {label}
      </span>
      <span
        className={cn(
          'rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
          present
            ? 'bg-green-50 text-green-700 ring-green-600/20'
            : 'bg-gray-50 text-gray-400 ring-gray-500/20'
        )}
      >
        {present ? 'Configured' : 'Not set'}
      </span>
    </div>
  );
}

export default function BotDetailPage() {
  const { botId } = useParams<{ botId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmDisable, setConfirmDisable] = useState(false);

  const { data: bot, isLoading, error } = useQuery<BotConfigResponse>({
    queryKey: ['bot', botId],
    queryFn: () => botsApi.getOne(botId).then((r) => r.data),
  });

  const disableMutation = useMutation({
    mutationFn: () => botsApi.disable(botId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bot', botId] });
      setConfirmDisable(false);
    },
  });

  const enableMutation = useMutation({
    mutationFn: () => botsApi.enable(botId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bots'] });
      queryClient.invalidateQueries({ queryKey: ['bot', botId] });
    },
  });

  if (isLoading) return <LoadingSpinner label="Loading bot…" />;

  if (error || !bot) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Bot not found or failed to load.{' '}
        <button
          onClick={() => router.back()}
          className="underline hover:no-underline"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Back + actions bar */}
      <div className="flex items-center justify-between">
        <Link
          href="/dashboard/bots"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to bots
        </Link>

        <div className="flex items-center gap-2">
          {/* Toggle enable/disable */}
          {bot.enabled ? (
            confirmDisable ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  Disable this bot?
                </span>
                <button
                  onClick={() => disableMutation.mutate()}
                  disabled={disableMutation.isPending}
                  className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-60"
                >
                  {disableMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <PowerOff className="h-3 w-3" />
                  )}
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDisable(false)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDisable(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <PowerOff className="h-4 w-4" />
                Disable
              </button>
            )
          ) : (
            <button
              onClick={() => enableMutation.mutate()}
              disabled={enableMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              {enableMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4 text-green-500" />
              )}
              Enable
            </button>
          )}

          {/* Edit */}
          <Link
            href={`/dashboard/bots/${bot.botId}/edit`}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            <Settings2 className="h-4 w-4" />
            Edit Bot
          </Link>
        </div>
      </div>

      {/* Bot header card */}
      <div className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-100 text-brand-700 font-bold text-lg uppercase">
          {bot.botId.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-xl font-bold text-gray-900">{bot.botName}</h2>
            <StatusBadge enabled={bot.enabled} />
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                getBotTypeBgColor(bot.botType)
              )}
            >
              {getBotTypeLabel(bot.botType)}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-gray-400">{bot.botId}</p>
        </div>
      </div>

      {/* Details */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">Details</h3>
        </div>
        <dl className="px-6">
          <InfoRow label="Bot ID" value={bot.botId} mono />
          <InfoRow label="Bot Name" value={bot.botName} />
          <InfoRow label="Bot Type" value={getBotTypeLabel(bot.botType)} />
          <InfoRow
            label="Phone Number ID"
            value={
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3 text-gray-400" />
                {bot.phoneNumberId}
              </span>
            }
            mono
          />
          <InfoRow
            label="Created"
            value={
              <span className="flex items-center gap-1">
                <CalendarClock className="h-3 w-3 text-gray-400" />
                {formatDateTime(bot.createdAt)}
              </span>
            }
          />
          <InfoRow
            label="Last Updated"
            value={
              <span className="flex items-center gap-1" title={formatDateTime(bot.updatedAt)}>
                <RefreshCw className="h-3 w-3 text-gray-400" />
                {formatRelativeTime(bot.updatedAt)}
              </span>
            }
          />
        </dl>
      </div>

      {/* Credentials */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">WhatsApp Credentials</h3>
          <p className="text-xs text-gray-400">
            Secret values are encrypted at rest and never returned by the API.
          </p>
        </div>
        <dl className="px-6">
          <CredentialRow
            label="Verify Token"
            present={bot.hasVerifyToken}
            icon={Fingerprint}
          />
          <CredentialRow
            label="Access Token"
            present={bot.hasAccessToken}
            icon={KeyRound}
          />
          <CredentialRow
            label="App Secret"
            present={bot.hasAppSecret}
            icon={ShieldCheck}
          />
        </dl>
      </div>

      {/* CamPay Credentials */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-900">CamPay Credentials</h3>
          <p className="text-xs text-gray-400">
            Secret values are encrypted at rest and never returned by the API.
          </p>
        </div>
        <dl className="px-6">
          <CredentialRow
            label="CamPay Secret (App Webhook Key)"
            present={bot.hasCampaySecret}
            icon={CreditCard}
          />
          <CredentialRow
            label="CamPay Token (Permanent Access Token)"
            present={bot.hasCampayToken}
            icon={Coins}
          />
        </dl>
      </div>

      {/* Config JSON */}
      {bot.config && Object.keys(bot.config).length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h3 className="text-sm font-semibold text-gray-900">
              Configuration
            </h3>
          </div>
          <pre className="overflow-x-auto p-6 text-xs font-mono text-gray-700 scrollbar-thin">
            {JSON.stringify(bot.config, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
